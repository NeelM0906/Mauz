import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

const REQUEST_TIMEOUT_MS = 30_000;

export type CodexThreadRequest = {
  folder: string;
  title: string;
  text: string;
  imagePath?: string | undefined;
  env: NodeJS.ProcessEnv;
};

type Call = (method: string, params: unknown) => Promise<unknown>;

/**
 * Creates a Codex thread in the folder with the task queued on it, and returns its id. The
 * Codex desktop app runs the queued turn when it wakes the thread (codex://threads/wake/<id>).
 */
export async function queueCodexThread(
  codexExecutable: string,
  request: CodexThreadRequest
): Promise<string> {
  const threadId = await withAppServer(codexExecutable, request.env, async (call) => {
    const started = (await call("thread/start", { cwd: request.folder })) as { thread?: { id?: unknown } };
    const id = started.thread?.id;

    if (typeof id !== "string") {
      throw new Error("Codex did not return a thread id.");
    }

    // Naming the thread writes it to disk, so a second app-server can queue on it.
    await call("thread/name/set", { threadId: id, name: request.title });

    return id;
  });

  // A separate app-server: queueing where the thread is loaded would run the turn in Mauz instead.
  await withAppServer(codexExecutable, request.env, (call) =>
    call("thread/queue/add", {
      threadId,
      clientUserMessageId: randomUUID(),
      input: [
        { type: "text", text: request.text, text_elements: [] },
        ...(request.imagePath === undefined ? [] : [{ type: "localImage", path: request.imagePath }])
      ]
    })
  );

  return threadId;
}

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
  createInterface({ input: child.stdout }).on("line", (line) => {
    let message: { id?: unknown; result?: unknown; error?: { message?: unknown } };

    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }

    const request = typeof message.id === "number" ? pending.get(message.id) : undefined;

    if (request === undefined) {
      return;
    }

    pending.delete(message.id as number);

    if (message.error === undefined) {
      request.resolve(message.result);
    } else {
      const detail = typeof message.error.message === "string" ? message.error.message : "unknown error";
      request.reject(new Error(`Codex refused the task: ${detail}`));
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

    const killTimer = setTimeout(() => child.kill(), 5_000);
    await exited;
    clearTimeout(killTimer);
  }
}
