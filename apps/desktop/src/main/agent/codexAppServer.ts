import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const REQUEST_TIMEOUT_MS = 30_000;
const AUTO_APPROVAL = {
  approvalPolicy: "on-request",
  approvalsReviewer: "auto_review",
  permissions: ":workspace"
} as const;

export type CodexThreadRequest = {
  folder: string;
  title: string;
  text: string;
  imagePath?: string | undefined;
  env: NodeJS.ProcessEnv;
};

type Call = (method: string, params: unknown) => Promise<unknown>;
type WithAppServer = typeof withAppServer;

/**
 * Creates a Codex thread in the folder with the task queued on it, and returns its id. The
 * Codex desktop app runs the queued turn when it wakes the thread (codex://threads/wake/<id>).
 */
export async function queueCodexThread(
  codexExecutable: string,
  request: CodexThreadRequest,
  withServer: WithAppServer = withAppServer
): Promise<string> {
  const threadId = await withServer(codexExecutable, request.env, async (call) => {
    const started = (await call("thread/start", { cwd: request.folder, ...AUTO_APPROVAL })) as {
      thread?: { id?: unknown };
    };
    const id = started.thread?.id;

    if (typeof id !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) {
      throw new Error("Codex did not return a thread id.");
    }

    // On current releases thread/start options alone do not survive a resume before the first turn.
    await call("thread/name/set", { threadId: id, name: request.title });
    await call("thread/settings/update", { threadId: id, ...AUTO_APPROVAL });

    return id;
  });

  await withServer(codexExecutable, request.env, async (call) => {
    const resumed = (await call("thread/resume", { threadId })) as {
      approvalPolicy?: unknown;
      approvalsReviewer?: unknown;
      activePermissionProfile?: { id?: unknown };
    } | null;
    if (
      resumed?.approvalPolicy !== AUTO_APPROVAL.approvalPolicy ||
      resumed.approvalsReviewer !== AUTO_APPROVAL.approvalsReviewer ||
      resumed.activePermissionProfile?.id !== AUTO_APPROVAL.permissions
    ) {
      throw new Error("Codex Desktop could not retain Approve for me for the new thread.");
    }
  });

  // Queue from a fresh app-server so the only client that starts the turn is Desktop.
  try {
    await withServer(codexExecutable, request.env, (call) =>
      call("thread/queue/add", {
        threadId,
        clientUserMessageId: randomUUID(),
        input: [
          { type: "text", text: request.text, text_elements: [] },
          ...(request.imagePath === undefined ? [] : [{ type: "localImage", path: request.imagePath }])
        ]
      })
    );
  } catch (error) {
    if (error instanceof CodexRefusal) throw error;
    throw new Error(
      "Mauz could not confirm whether Codex queued the task. Check the new Codex thread before retrying."
    );
  }

  return threadId;
}

class CodexRefusal extends Error {}

async function withAppServer<T>(
  codexExecutable: string,
  env: NodeJS.ProcessEnv,
  work: (call: Call) => Promise<T>
): Promise<T> {
  const child = spawn(codexExecutable, ["app-server"], {
    env,
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 0;
  let failure: Error | null = null;
  const failAll = (error: Error): void => {
    failure ??= error;

    for (const request of pending.values()) {
      request.reject(failure);
    }

    pending.clear();
  };
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });

  child.once("error", (error) => failAll(new Error(`Could not start Codex: ${error.message}`)));
  child.once("exit", () => failAll(new Error("Codex stopped before it answered.")));
  child.stdin.on("error", () => failAll(new Error("Codex stopped accepting requests.")));
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } } | null;

    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }

    if (typeof message?.id !== "number") return;
    const request = pending.get(message.id);
    if (request === undefined) return;

    pending.delete(message.id);

    if (message.error === undefined) {
      request.resolve(message.result);
    } else {
      const detail = typeof message.error.message === "string" ? message.error.message : "unknown error";
      request.reject(new CodexRefusal(`Codex refused the task: ${detail}`));
    }
  });

  const send = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const call: Call = (method, params) =>
    new Promise((resolve, reject) => {
      if (failure !== null) {
        reject(failure);
        return;
      }

      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Codex took too long to answer."));
      }, REQUEST_TIMEOUT_MS);
      const settle =
        <V>(done: (value: V) => void) =>
        (value: V): void => {
          clearTimeout(timer);
          done(value);
        };

      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      send({ id, method, params });
    });

  try {
    await call("initialize", {
      clientInfo: { name: "mauz", title: "Mauz", version: "1.0.0" },
      // The thread queue is part of the experimental API.
      capabilities: { experimentalApi: true }
    });
    send({ method: "initialized" });

    return await work(call);
  } finally {
    child.stdin.end();

    const killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(killTimer);
  }
}
