import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiProviderError } from "../errors";
import { buildCliEnvironment, resolveCliCommand, type ResolvedCliCommand } from "./cliCommand";
import {
  describeCliFailure,
  killQuietly,
  parseJsonLine,
  runAndCollect,
  spawnCliProcess,
  toCliError,
  type AnswerCli,
  type ChildProcessLike,
  type SpawnLike
} from "./processRunner";
import type { AnswerOptions, AnswerPrompt, AnswerProvider, AnswerResult } from "./types";

export const DEFAULT_CLAUDE_CODE_MODEL = "sonnet";
export const DEFAULT_CLAUDE_CODE_EFFORT = "low";
const ANSWER_TIMEOUT_MS = 120_000;
export const CLAUDE_CLI: AnswerCli = {
  label: "Claude Code",
  signInKeywords: ["/login", "not logged in", "invalid api key", "authentication"],
  signInMessage: "Claude Code isn't signed in. Open a terminal, run `claude`, sign in, then try again."
};
/** A pre-started CLI is only reused while it is fresh; an idle one is stopped to free memory. */
const WARM_PROCESS_MAX_IDLE_MS = 3 * 60_000;

export type ClaudeCodeProviderOptions = {
  spawn?: SpawnLike;
  resolveCommand?: () => ResolvedCliCommand | null;
  env?: () => NodeJS.ProcessEnv;
  model?: () => string;
  effort?: () => string;
  makeWorkingDirectory?: () => string;
  answerTimeoutMs?: number;
};

type Launch = {
  key: string;
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

type WarmProcess = {
  key: string;
  child: ChildProcessLike;
  idleTimer: NodeJS.Timeout;
};

/**
 * Answers through the user's signed-in Claude Code CLI (their Claude subscription),
 * with tools, hooks, MCP servers, slash commands and session history all disabled.
 */
export class ClaudeCodeProvider implements AnswerProvider {
  readonly id = "claude-code" as const;
  private readonly spawnProcess: SpawnLike;
  private readonly resolveCommand: () => ResolvedCliCommand | null;
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly readModel: () => string;
  private readonly readEffort: () => string;
  private readonly makeWorkingDirectory: () => string;
  private readonly answerTimeoutMs: number;
  private warm: WarmProcess | null = null;

  constructor(options: ClaudeCodeProviderOptions = {}) {
    this.spawnProcess = options.spawn ?? spawnCliProcess;
    this.readEnv = options.env ?? (() => process.env);
    this.resolveCommand =
      options.resolveCommand ??
      (() =>
        resolveCliCommand("claude", {
          env: this.readEnv(),
          fallbackNodeRuntime: process.versions.electron === undefined ? undefined : process.execPath
        }));
    this.readModel =
      options.model ?? (() => this.readEnv().MAUZ_CLAUDE_CODE_MODEL?.trim() || DEFAULT_CLAUDE_CODE_MODEL);
    this.readEffort =
      options.effort ?? (() => this.readEnv().MAUZ_CLAUDE_CODE_EFFORT?.trim() || DEFAULT_CLAUDE_CODE_EFFORT);
    this.makeWorkingDirectory = options.makeWorkingDirectory ?? getClaudeWorkingDirectory;
    this.answerTimeoutMs = options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
  }

  prewarm(systemPrompt: string): void {
    const launch = this.buildLaunch(systemPrompt);

    if (launch === null) {
      return;
    }

    if (this.warm !== null && this.warm.key === launch.key && isRunning(this.warm.child)) {
      this.resetIdleTimer(this.warm);
      return;
    }

    this.discardWarm();

    try {
      const child = this.startProcess(launch);
      const warm: WarmProcess = {
        key: launch.key,
        child,
        idleTimer: setTimeout(() => this.discardWarm(), WARM_PROCESS_MAX_IDLE_MS)
      };

      child.once("exit", () => {
        if (this.warm?.child === child) {
          clearTimeout(warm.idleTimer);
          this.warm = null;
        }
      });
      this.warm = warm;
    } catch {
      // Prewarming is an optimization; answer() reports real failures.
    }
  }

  async answer(prompt: AnswerPrompt, options: AnswerOptions = {}): Promise<AnswerResult> {
    const launch = this.buildLaunch(prompt.systemPrompt);

    if (launch === null) {
      throw new AiProviderError(
        this.id,
        "Claude Code is not installed. Install it from claude.com/claude-code, run `claude` once to sign in, then try again."
      );
    }

    const child = this.takeWarm(launch.key) ?? this.startProcess(launch);

    return this.runTurn(child, prompt, options);
  }

  dispose(): void {
    this.discardWarm();
  }

  private buildLaunch(systemPrompt: string): Launch | null {
    const command = this.resolveCommand();

    if (command === null) {
      return null;
    }

    const model = this.readModel();
    const effort = this.readEffort();
    const args = [
      ...command.args,
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--system-prompt",
      systemPrompt,
      "--model",
      model,
      ...(effort.length > 0 ? ["--effort", effort] : []),
      "--settings",
      JSON.stringify({ disableAllHooks: true }),
      "--tools",
      "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--strict-mcp-config",
      "--permission-mode",
      "dontAsk"
    ];
    // Strip API keys so the CLI answers on the user's subscription, never a key Mauz holds.
    const env = { ...buildCliEnvironment(this.readEnv()), ...command.env };

    return {
      key: JSON.stringify([command.command, args]),
      command: command.command,
      args,
      env
    };
  }

  private startProcess(launch: Launch): ChildProcessLike {
    return this.spawnProcess(launch.command, launch.args, {
      cwd: this.makeWorkingDirectory(),
      env: launch.env
    });
  }

  private takeWarm(key: string): ChildProcessLike | null {
    const warm = this.warm;

    if (warm === null) {
      return null;
    }

    this.warm = null;
    clearTimeout(warm.idleTimer);

    if (warm.key !== key || !isRunning(warm.child)) {
      killQuietly(warm.child);
      return null;
    }

    return warm.child;
  }

  private discardWarm(): void {
    const warm = this.warm;
    this.warm = null;

    if (warm !== null) {
      clearTimeout(warm.idleTimer);
      killQuietly(warm.child);
    }
  }

  private resetIdleTimer(warm: WarmProcess): void {
    clearTimeout(warm.idleTimer);
    warm.idleTimer = setTimeout(() => this.discardWarm(), WARM_PROCESS_MAX_IDLE_MS);
  }

  private async runTurn(
    child: ChildProcessLike,
    prompt: AnswerPrompt,
    options: AnswerOptions
  ): Promise<AnswerResult> {
    let streamedText = "";
    // Written by the line callback; the casts stop TypeScript from narrowing them to null.
    let resultText = null as string | null;
    let resultError = null as string | null;

    // runAndCollect settles on "close", after stdout is fully drained, so the result line has been read.
    const output = await runAndCollect(child, {
      stdinText: `${JSON.stringify(buildUserMessage(prompt))}\n`,
      timeoutMs: this.answerTimeoutMs,
      onStdoutLine: (line) => {
        const event = parseJsonLine(line);

        if (event === null) {
          return;
        }

        const textDelta = getTextDelta(event);

        if (textDelta !== null) {
          streamedText += textDelta;
          options.onText?.(streamedText);
          return;
        }

        if (event.type === "result") {
          if (event.is_error === true || event.subtype !== "success") {
            resultError = typeof event.result === "string" ? event.result : String(event.subtype ?? "error");
          } else if (typeof event.result === "string") {
            resultText = event.result;
          }
        }
      }
    }).catch((error: unknown) => {
      throw toCliError(this.id, CLAUDE_CLI.label, error);
    });
    const text = (resultText ?? streamedText).trim();

    if (resultError === null && text.length > 0) {
      return { text };
    }

    throw new AiProviderError(
      this.id,
      describeCliFailure(CLAUDE_CLI, resultError ?? output.stderr, output.exitCode)
    );
  }
}

function buildUserMessage(prompt: AnswerPrompt): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];

  for (const image of prompt.images) {
    content.push({ type: "text", text: image.label });
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.mimeType, data: image.base64 }
    });
  }

  content.push({ type: "text", text: prompt.userText });

  return {
    type: "user",
    message: {
      role: "user",
      content
    }
  };
}

function getTextDelta(event: Record<string, unknown>): string | null {
  if (event.type !== "stream_event") {
    return null;
  }

  const streamEvent = event.event as Record<string, unknown> | undefined;

  if (streamEvent?.type !== "content_block_delta") {
    return null;
  }

  const delta = streamEvent.delta as Record<string, unknown> | undefined;

  return delta?.type === "text_delta" && typeof delta.text === "string" ? delta.text : null;
}

function isRunning(child: ChildProcessLike): boolean {
  return child.exitCode === null && !child.killed;
}

/** An empty directory outside any project, so no project CLAUDE.md or settings apply. */
function getClaudeWorkingDirectory(): string {
  const directory = join(tmpdir(), "mauz-claude-workdir");
  mkdirSync(directory, { recursive: true });

  return directory;
}
