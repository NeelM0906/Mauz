import { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { AiProviderError } from "../errors";

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
  /** Called for each complete stdout line as it arrives; stdout is still collected. */
  onStdoutLine?: ((line: string) => void) | undefined;
};

export class ProcessTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The command did not finish within ${Math.round(timeoutMs / 1000)} seconds.`);
    this.name = "ProcessTimeoutError";
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
      callback();
    };
    const timer = setTimeout(() => {
      killQuietly(child);
      finish(() => reject(new ProcessTimeoutError(options.timeoutMs)));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += stdoutDecoder.write(chunk);
    });
    if (options.onStdoutLine !== undefined) {
      onLines(child.stdout, options.onStdoutLine);
    }
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
function onLines(stream: Readable | null, onLine: (line: string) => void): void {
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

/** What an answer CLI is called and how its "signed out" errors read. */
export type AnswerCli = {
  label: string;
  signInKeywords: readonly string[];
  signInMessage: string;
};

/** A message for the user from a CLI's error text, or from its exit code when it printed nothing. */
export function describeCliFailure(cli: AnswerCli, detail: string, exitCode: number | null): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  const lowered = normalized.toLowerCase();

  if (cli.signInKeywords.some((keyword) => lowered.includes(keyword))) {
    return cli.signInMessage;
  }

  if (lowered.includes("usage limit") || lowered.includes("rate limit")) {
    return `${cli.label} reported a usage limit: ${truncate(normalized)}`;
  }

  if (normalized.length > 0) {
    return `${cli.label} could not answer: ${truncate(normalized)}`;
  }

  return `${cli.label} exited without an answer (code ${exitCode ?? "unknown"}).`;
}

/** Turns a `runAndCollect` rejection (timeout or start failure) into a message for the user. */
export function toCliError(providerId: string, label: string, error: unknown): AiProviderError {
  if (error instanceof ProcessTimeoutError) {
    return new AiProviderError(providerId, `${label} did not answer in time. Try again.`, { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);

  return new AiProviderError(providerId, `Mauz could not start ${label}: ${message}`, { cause: error });
}

function truncate(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
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
