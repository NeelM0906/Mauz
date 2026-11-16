import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { queueCodexThread } from "../src/main/agent/codexAppServer";
import { parseBootstrap, submitHermesTask, type HermesTaskRequest } from "../src/main/agent/hermesGateway";

const CODEX_THREAD = "00000000-0000-4000-8000-000000000001";
const CODEX_REQUEST = {
  env: {},
  folder: "/project",
  title: "Inspect the issue",
  text: "Task with screenshot",
  imagePath: "/handoff/screen.png"
};
const CODEX_PERMISSIONS = {
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  permissions: ":workspace"
};

function codexResponses(reviewer: string, queueError?: Error) {
  const create = vi.fn(async (method: string) =>
    method === "thread/start" ? { thread: { id: CODEX_THREAD } } : {}
  );
  const resume = vi.fn(async () => ({
    approvalPolicy: "on-request",
    approvalsReviewer: reviewer,
    activePermissionProfile: { id: ":workspace" }
  }));
  const queue = vi.fn(async () => {
    if (queueError !== undefined) throw queueError;
    return { queuedSubmission: {} };
  });
  const servers = [create, resume, queue];
  const withServer: NonNullable<Parameters<typeof queueCodexThread>[2]> = async (_command, _env, run) =>
    run(servers.shift()!);
  return { create, resume, queue, withServer };
}

describe("Codex Desktop handoff", () => {
  it("persists auto review before a new server queues the task without starting it", async () => {
    const { create, resume, queue, withServer } = codexResponses("auto_review");

    await expect(queueCodexThread("/codex", CODEX_REQUEST, withServer)).resolves.toBe(CODEX_THREAD);

    expect(create.mock.calls).toEqual([
      ["thread/start", { cwd: CODEX_REQUEST.folder, ...CODEX_PERMISSIONS }],
      ["thread/name/set", { threadId: CODEX_THREAD, name: CODEX_REQUEST.title }],
      ["thread/settings/update", { threadId: CODEX_THREAD, ...CODEX_PERMISSIONS }]
    ]);
    expect(resume).toHaveBeenCalledExactlyOnceWith("thread/resume", { threadId: CODEX_THREAD });
    expect(queue).toHaveBeenCalledExactlyOnceWith("thread/queue/add", {
      threadId: CODEX_THREAD,
      clientUserMessageId: expect.any(String),
      input: [
        { type: "text", text: CODEX_REQUEST.text, text_elements: [] },
        { type: "localImage", path: CODEX_REQUEST.imagePath }
      ]
    });
  });

  it("leaves the task unsubmitted if auto review is lost on resume", async () => {
    const { queue, withServer } = codexResponses("user");

    await expect(queueCodexThread("/codex", CODEX_REQUEST, withServer)).rejects.toThrow("Approve for me");
    expect(queue).not.toHaveBeenCalled();
  });

  it("reports an uncertain queue result without submitting twice", async () => {
    const { queue, withServer } = codexResponses("auto_review", new Error("Disconnected"));

    await expect(queueCodexThread("/codex", CODEX_REQUEST, withServer)).rejects.toThrow(
      "could not confirm whether Codex queued"
    );
    expect(queue).toHaveBeenCalledOnce();
  });
});

const HERMES_REQUEST: HermesTaskRequest = {
  attach: async () => "bootstrap",
  cwd: "/project",
  text: "Task for Hermes",
  imagePath: undefined,
  desktop: true
};

function hermesResponses(mode = "smart", submitError?: Error) {
  const call = vi.fn(async (method: string) => {
    switch (method) {
      case "runtime.describe":
        return { session_create: { sources: ["cli", "gui"], parameters: ["cwd"] } };
      case "config.get":
        return { value: mode };
      case "session.create":
        return { session_id: "runtime-id", stored_session_id: "stored-id" };
      case "image.attach_bytes":
        return { attached: true, path: "/hermes/images/screen.png", mime: "image/png" };
      case "prompt.submit":
        if (submitError !== undefined) throw submitError;
        return { admission_id: "admission-id" };
      default:
        throw new Error(`Unexpected RPC: ${method}`);
    }
  });
  const close = vi.fn();
  const connect = vi.fn(async (_output: string) => ({ call, close }));
  return { call, close, connect };
}

describe("Hermes gateway handoff", () => {
  it("returns the new desktop session as soon as the gateway accepts the image and prompt", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mauz-hermes-test-"));
    const imagePath = join(directory, "screen.png");
    await writeFile(imagePath, "image-bytes");
    const { call, close, connect } = hermesResponses();

    await expect(submitHermesTask({ ...HERMES_REQUEST, imagePath }, connect)).resolves.toBe("stored-id");

    expect(connect).toHaveBeenCalledExactlyOnceWith("bootstrap");
    expect(call.mock.calls).toEqual([
      ["config.get", { key: "approvals.mode" }],
      ["runtime.describe", {}],
      ["session.create", { request_id: expect.any(String), source: "gui", cwd: "/project" }],
      [
        "image.attach_bytes",
        {
          session_id: "runtime-id",
          filename: "screen.png",
          content_base64: Buffer.from("image-bytes").toString("base64")
        }
      ],
      [
        "prompt.submit",
        {
          session_id: "runtime-id",
          submission_id: expect.any(String),
          text: HERMES_REQUEST.text,
          attachments: [{ path: "/hermes/images/screen.png", mime: "image/png" }]
        }
      ]
    ]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses a finite guarded submission for CLI fallback with a screenshot", async () => {
    const { call, connect } = hermesResponses();

    await submitHermesTask({ ...HERMES_REQUEST, desktop: false }, connect);

    expect(call).toHaveBeenCalledWith("session.create", expect.objectContaining({ source: "cli" }));
    expect(call).toHaveBeenLastCalledWith("prompt.submit", expect.objectContaining({ finite: true }));
    expect(call).not.toHaveBeenCalledWith("prompt.submit", expect.objectContaining({ unattended: true }));
  });

  it("refuses an unguarded profile before creating a session", async () => {
    const { call, close, connect } = hermesResponses("off");

    await expect(submitHermesTask(HERMES_REQUEST, connect)).rejects.toThrow("Smart approvals");
    expect(call.mock.calls).toEqual([["config.get", { key: "approvals.mode" }]]);
    expect(close).toHaveBeenCalledOnce();
  });

  it("reports an uncertain receipt and closes without resubmitting", async () => {
    const { call, close, connect } = hermesResponses("smart", new Error("Disconnected"));

    await expect(submitHermesTask(HERMES_REQUEST, connect)).rejects.toThrow("Check Hermes session stored-id");
    expect(call.mock.calls.filter(([method]) => method === "prompt.submit")).toHaveLength(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("only accepts an authenticated loopback gateway and keeps the ticket out of errors", () => {
    const endpoint = {
      url: "ws://127.0.0.1:8765/api/ws",
      protocol: "hermes-gateway-v1",
      ticket: "private-ticket",
      protocols: ["hermes-gateway-v1", "hermes-gateway-ticket.private-ticket"]
    };
    expect(parseBootstrap(JSON.stringify(endpoint))).toEqual({
      url: endpoint.url,
      protocols: endpoint.protocols
    });
    expect(() =>
      parseBootstrap(JSON.stringify({ ...endpoint, url: "ws://example.test:8765/api/ws" }))
    ).toThrow("Hermes did not return a supported local gateway endpoint.");
    expect(() => parseBootstrap("private-ticket")).toThrow(
      /^Hermes did not return a supported local gateway endpoint\.$/
    );
  });
});
