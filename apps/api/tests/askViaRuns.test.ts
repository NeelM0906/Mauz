import { describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { askViaRuns } from "../src/backend/askViaRuns";

// Intersection type so vi.fn().mock.calls is accessible while satisfying typeof fetch
type MockedFetch = typeof fetch & ReturnType<typeof vi.fn>;

function runsFetchMock(events: string[]): MockedFetch {
  return vi.fn().mockImplementation((url: string) => {
    if (url.endsWith("/runs")) {
      return Promise.resolve(
        new Response(JSON.stringify({ run_id: "run_1", status: "started" }), { status: 202 })
      );
    }
    if (url.endsWith("/events")) {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(new TextEncoder().encode(`data: ${event}\n\n`));
          }
          controller.close();
        }
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as MockedFetch;
}

function buildRequest(): AskMauzRequest {
  return {
    question: "What is this?",
    context: {
      timestamp: new Date("2026-05-13T20:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: { x: 100, y: 200 }
    }
  };
}

const BASE_OPTIONS = {
  baseUrl: "http://localhost:8642/v1",
  model: "hermes-agent",
  installId: "install-1"
} as const;

describe("askViaRuns", () => {
  it("returns the run output as the answer", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"run.completed","run_id":"run_1","output":"answer text","usage":{"total_tokens":9}}'
    ]);
    const response = await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl });
    expect(response).toMatchObject({ answer: "answer text", model: "hermes-agent" });
  });

  it("auto-approves in yolo mode without invoking the handler", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"run terminal command"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onApprovalRequest = vi.fn();
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl, onApprovalRequest });
    expect(onApprovalRequest).not.toHaveBeenCalled();
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(approvalCall).toBeDefined();
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "session" });
  });

  it("asks the approval handler in approve mode and forwards the choice", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"edit file"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onApprovalRequest = vi.fn().mockResolvedValue("deny");
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "approve", fetchImpl, onApprovalRequest });
    expect(onApprovalRequest).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run_1", description: "edit file" })
    );
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "deny" });
  });

  it("denies approval after timeout when handler never resolves", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"edit file"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    // Handler that never resolves
    const onApprovalRequest = vi.fn().mockReturnValue(new Promise(() => {}));
    const result = await askViaRuns(buildRequest(), {
      ...BASE_OPTIONS,
      agentMode: "approve",
      fetchImpl,
      onApprovalRequest,
      timeouts: { approvalMs: 50 }
    });
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "deny" });
    expect(result.answer).toBe("done");
  });

  it("denies approval when handler throws", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"approval.request","run_id":"run_1","description":"edit file"}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onApprovalRequest = vi.fn().mockRejectedValue(new Error("handler blew up"));
    const result = await askViaRuns(buildRequest(), {
      ...BASE_OPTIONS,
      agentMode: "approve",
      fetchImpl,
      onApprovalRequest
    });
    const approvalCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/approval"));
    expect(JSON.parse(approvalCall![1].body as string)).toEqual({ choice: "deny" });
    expect(result.answer).toBe("done");
  });

  it("throws on run.failed and on run.cancelled", async () => {
    const failed = runsFetchMock(['{"event":"run.failed","run_id":"run_1","error":"boom"}']);
    await expect(
      askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: failed })
    ).rejects.toThrow("boom");

    const cancelled = runsFetchMock(['{"event":"run.cancelled","run_id":"run_1"}']);
    await expect(
      askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: cancelled })
    ).rejects.toThrow(/stopped/i);
  });

  it("calls stopRun on run.failed but not on successful completion", async () => {
    // run.failed → stopRun should be called
    const failedFetch = runsFetchMock(['{"event":"run.failed","run_id":"run_1","error":"boom"}']);
    await expect(
      askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: failedFetch })
    ).rejects.toThrow("boom");
    const stopAfterFailure = failedFetch.mock.calls.find(([url]) => String(url).endsWith("/stop"));
    expect(stopAfterFailure).toBeDefined();

    // run.completed → stopRun should NOT be called
    const completedFetch = runsFetchMock(['{"event":"run.completed","run_id":"run_1","output":"ok"}']);
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl: completedFetch });
    const stopAfterSuccess = completedFetch.mock.calls.find(([url]) => String(url).endsWith("/stop"));
    expect(stopAfterSuccess).toBeUndefined();
  });

  it("does not call stopRun on run.cancelled", async () => {
    const fetchImpl = runsFetchMock(['{"event":"run.cancelled","run_id":"run_1"}']);
    await expect(
      askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl })
    ).rejects.toThrow();
    const stopCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/stop"));
    expect(stopCall).toBeUndefined();
  });

  it("retries polling and returns the answer on the 2nd poll", async () => {
    let pollCount = 0;
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/runs")) {
        return Promise.resolve(new Response(JSON.stringify({ run_id: "run_1" }), { status: 202 }));
      }
      if (url.endsWith("/events")) {
        // Stream closes immediately without a terminal event
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      if (/\/runs\/run_1$/.test(url)) {
        pollCount++;
        if (pollCount === 1) {
          return Promise.resolve(new Response(JSON.stringify({ status: "running" }), { status: 200 }));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: "completed", output: "retried answer" }), { status: 200 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as MockedFetch;

    const result = await askViaRuns(buildRequest(), {
      ...BASE_OPTIONS,
      agentMode: "yolo",
      fetchImpl,
      pollRetries: { delayMs: 0 }
    });

    expect(result.answer).toBe("retried answer");
    expect(pollCount).toBe(2);
  });

  it("leaves a still-running run alive after poll retries are exhausted", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/runs")) {
        return Promise.resolve(new Response(JSON.stringify({ run_id: "run_1" }), { status: 202 }));
      }
      if (url.endsWith("/events")) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      // Status always returns running
      if (/\/runs\/run_1$/.test(url)) {
        return Promise.resolve(new Response(JSON.stringify({ status: "running" }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as MockedFetch;

    await expect(
      askViaRuns(buildRequest(), {
        ...BASE_OPTIONS,
        agentMode: "yolo",
        fetchImpl,
        pollRetries: { max: 2, delayMs: 0 }
      })
    ).rejects.toThrow(/still working/);
    const stopCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/stop"));
    expect(stopCall).toBeUndefined();
  });

  it("throws lost-connection and stops the run when status polling gets no answer", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/runs")) {
        return Promise.resolve(new Response(JSON.stringify({ run_id: "run_1" }), { status: 202 }));
      }
      if (url.endsWith("/events")) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      // Status endpoint unreachable: getRunStatus resolves to null
      if (/\/runs\/run_1$/.test(url)) {
        return Promise.reject(new Error("connection refused"));
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as MockedFetch;

    await expect(
      askViaRuns(buildRequest(), {
        ...BASE_OPTIONS,
        agentMode: "yolo",
        fetchImpl,
        pollRetries: { max: 2, delayMs: 0 }
      })
    ).rejects.toThrow(/Lost connection/);
    const stopCall = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/stop"));
    expect(stopCall).toBeDefined();
  });

  it("surfaces a failed status discovered via polling", async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/runs")) {
        return Promise.resolve(new Response(JSON.stringify({ run_id: "run_1" }), { status: 202 }));
      }
      if (url.endsWith("/events")) {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            c.close();
          }
        });
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      if (/\/runs\/run_1$/.test(url)) {
        return Promise.resolve(
          new Response(JSON.stringify({ status: "failed", error: "tool exploded" }), { status: 200 })
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as MockedFetch;

    await expect(
      askViaRuns(buildRequest(), {
        ...BASE_OPTIONS,
        agentMode: "yolo",
        fetchImpl,
        pollRetries: { max: 2, delayMs: 0 }
      })
    ).rejects.toThrow("tool exploded");
  });

  it("invokes onRunActivity for tool.started and tool.completed events", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"tool.started","run_id":"run_1","tool":"terminal","preview":"ls ~/Desktop"}',
      '{"event":"tool.completed","run_id":"run_1","tool":"terminal","duration":120}',
      '{"event":"run.completed","run_id":"run_1","output":"done"}'
    ]);
    const onRunActivity = vi.fn();
    await askViaRuns(buildRequest(), { ...BASE_OPTIONS, agentMode: "yolo", fetchImpl, onRunActivity });
    expect(onRunActivity).toHaveBeenCalledTimes(2);
    expect(onRunActivity).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        runId: "run_1",
        kind: "tool.started",
        tool: "terminal",
        label: "terminal — ls ~/Desktop"
      })
    );
    expect(onRunActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        runId: "run_1",
        kind: "tool.completed",
        tool: "terminal",
        label: "terminal done"
      })
    );
  });

  it("does not let a throwing onRunActivity hook abort the run", async () => {
    const fetchImpl = runsFetchMock([
      '{"event":"tool.started","run_id":"run_1","tool":"terminal","preview":"ls"}',
      '{"event":"run.completed","run_id":"run_1","output":"fine"}'
    ]);
    const onRunActivity = vi.fn().mockImplementation(() => {
      throw new Error("hook blew up");
    });
    const response = await askViaRuns(buildRequest(), {
      ...BASE_OPTIONS,
      agentMode: "yolo",
      fetchImpl,
      onRunActivity
    });
    expect(response.answer).toBe("fine");
  });
});
