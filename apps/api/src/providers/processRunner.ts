import { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export type ChildProcessLike = {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  exitCode: number | null;
  killed: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit" | "close", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

export type SpawnOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
};

export type SpawnLike = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcessLike;

export const spawnCliProcess: SpawnLike = (command, args, options) =>
  nodeSpawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"],
    // Electron is a GUI process; without this every CLI call flashes a console window on Windows.
    windowsHide: true
  });

export type CollectedOutput = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type RunCollectOptions = {
  stdinText?: string | undefined;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
};

export class ProcessTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The command did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "ProcessTimeoutError";
  }
}

export class ProcessAbortedError extends Error {
  constructor() {
    super("The command was cancelled.");
    this.name = "ProcessAbortedError";
  }
}

/** Runs a process to completion and collects its output. */
export function runAndCollect(child: ChildProcessLike, options: RunCollectOptions): Promise<CollectedOutput> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = (): void => {
      killQuietly(child);
      finish(() => reject(new ProcessAbortedError()));
    };
    const timer = setTimeout(() => {
      killQuietly(child);
      finish(() => reject(new ProcessTimeoutError(options.timeoutMs)));
    }, options.timeoutMs);

    if (options.signal?.aborted === true) {
      onAbort();
      return;
    }

    options.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += stdoutDecoder.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += stderrDecoder.write(chunk);
    });
    child.once("error", (error) => {
      finish(() => reject(error));
    });
    // "close" fires after stdout/stderr are fully drained, unlike "exit".
    child.once("close", (code) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      finish(() => resolve({ stdout, stderr, exitCode: code }));
    });

    child.stdin?.on("error", () => {
      // The process may exit before reading stdin; the exit handler reports the outcome.
    });
    child.stdin?.end(options.stdinText ?? "");
  });
}

/** Calls `onLine` for each complete line written to the stream. */
export function onLines(stream: Readable | null, onLine: (line: string) => void): void {
  if (stream === null) {
    return;
  }

  const decoder = new StringDecoder("utf8");
  let buffer = "";

  stream.on("data", (chunk: Buffer) => {
    buffer += decoder.write(chunk);
    let newlineIndex = buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);

      if (line.length > 0) {
        onLine(line);
      }

      newlineIndex = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    const line = (buffer + decoder.end()).trim();
    buffer = "";

    if (line.length > 0) {
      onLine(line);
    }
  });
}

export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;

    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function killQuietly(child: ChildProcessLike): void {
  try {
    if (!child.killed && child.exitCode === null) {
      child.kill();
    }
  } catch {
    // The process already exited.
  }
}
