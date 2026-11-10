import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiProviderError } from "../errors";
import { buildCliEnvironment, resolveCliCommand, type ResolvedCliCommand } from "./cliCommand";
import {
  ProcessTimeoutError,
  parseJsonLine,
  runAndCollect,
  spawnCliProcess,
  type SpawnLike
} from "./processRunner";
import type { AnswerOptions, AnswerPrompt, AnswerProvider, AnswerResult } from "./types";

export const DEFAULT_CODEX_REASONING_EFFORT = "low";
const ANSWER_TIMEOUT_MS = 180_000;

export type CodexProviderOptions = {
  spawn?: SpawnLike;
  resolveCommand?: () => ResolvedCliCommand | null;
  env?: () => NodeJS.ProcessEnv;
  model?: () => string | undefined;
  reasoningEffort?: () => string;
  makeWorkingDirectory?: () => Promise<string>;
  answerTimeoutMs?: number;
};

/**
 * Answers through the user's signed-in Codex CLI (their ChatGPT subscription). Runs
 * ephemeral, read-only, outside any repository, and ignores the user's Codex config so
 * their MCP servers and plugins never see Mauz prompts.
 */
export class CodexProvider implements AnswerProvider {
  readonly id = "codex" as const;
  private readonly spawnProcess: SpawnLike;
  private readonly resolveCommand: () => ResolvedCliCommand | null;
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly readModel: () => string | undefined;
  private readonly readReasoningEffort: () => string;
  private readonly makeWorkingDirectory: () => Promise<string>;
  private readonly answerTimeoutMs: number;

  constructor(options: CodexProviderOptions = {}) {
    this.spawnProcess = options.spawn ?? spawnCliProcess;
    this.readEnv = options.env ?? (() => process.env);
    this.resolveCommand =
      options.resolveCommand ??
      (() =>
        resolveCliCommand("codex", {
          env: this.readEnv(),
          fallbackNodeRuntime: process.versions.electron === undefined ? undefined : process.execPath
        }));
    this.readModel = options.model ?? (() => this.readEnv().MAUZ_CODEX_MODEL?.trim() || undefined);
    this.readReasoningEffort =
      options.reasoningEffort ??
      (() => this.readEnv().MAUZ_CODEX_REASONING_EFFORT?.trim() || DEFAULT_CODEX_REASONING_EFFORT);
    this.makeWorkingDirectory =
      options.makeWorkingDirectory ?? (() => mkdtemp(join(tmpdir(), "mauz-codex-")));
    this.answerTimeoutMs = options.answerTimeoutMs ?? ANSWER_TIMEOUT_MS;
  }

  async answer(prompt: AnswerPrompt, options: AnswerOptions = {}): Promise<AnswerResult> {
    const command = this.resolveCommand();

    if (command === null) {
      throw new AiProviderError(
        this.id,
        "Codex is not installed. Install it with `npm install -g @openai/codex`, run `codex login`, then try again."
      );
    }

    const workingDirectory = await this.makeWorkingDirectory();

    try {
      const imagePaths = await writeImages(workingDirectory, prompt);
      const model = this.readModel();
      const args = [
        ...command.args,
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--ignore-user-config",
        "--sandbox",
        "read-only",
        "--config",
        "features.plugins=false",
        "--config",
        "features.apps=false",
        "--config",
        `model_reasoning_effort="${this.readReasoningEffort()}"`,
        ...(model === undefined ? [] : ["--model", model]),
        ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
        "-"
      ];
      const child = this.spawnProcess(command.command, args, {
        cwd: workingDirectory,
        env: { ...buildCliEnvironment(this.readEnv()), ...command.env }
      });
      const output = await runAndCollect(child, {
        stdinText: buildCodexPrompt(prompt),
        timeoutMs: this.answerTimeoutMs
      }).catch((error: unknown) => {
        throw toCodexError(this.id, error);
      });
      const parsed = parseCodexOutput(output.stdout);

      if (parsed.text.length > 0) {
        options.onText?.(parsed.text);
        return {
          text: parsed.text,
          model: model === undefined ? "codex" : `codex:${model}`,
          ...(parsed.usage === undefined ? {} : { usage: parsed.usage })
        };
      }

      throw new AiProviderError(
        this.id,
        describeCodexFailure(parsed.error ?? output.stderr, output.exitCode)
      );
    } finally {
      await rm(workingDirectory, { recursive: true, force: true }).catch(() => {});
    }
  }
}

async function writeImages(directory: string, prompt: AnswerPrompt): Promise<string[]> {
  const paths: string[] = [];

  for (const [index, image] of prompt.images.entries()) {
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    const path = join(directory, `mauz-image-${index + 1}.${extension}`);
    await writeFile(path, Buffer.from(image.base64, "base64"));
    paths.push(path);
  }

  return paths;
}

function buildCodexPrompt(prompt: AnswerPrompt): string {
  const imageLines =
    prompt.images.length === 0
      ? []
      : ["Attached images, in order:", ...prompt.images.map((image) => `- ${image.label}`), ""];

  return [
    prompt.systemPrompt,
    "",
    "You are answering inside a desktop popup. Do not run shell commands, read files, or use tools; answer directly from this message and the attached images.",
    "",
    ...imageLines,
    prompt.userText
  ].join("\n");
}

type ParsedCodexOutput = {
  text: string;
  error?: string | undefined;
  usage?: unknown;
};

export function parseCodexOutput(stdout: string): ParsedCodexOutput {
  let text = "";
  let error: string | undefined;
  let usage: unknown;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const event = parseJsonLine(rawLine.trim());

    if (event === null) {
      continue;
    }

    const item = event.item as Record<string, unknown> | undefined;

    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      text = item.text.trim();
    } else if (event.type === "turn.completed") {
      usage = event.usage;
    } else if (event.type === "turn.failed" || event.type === "error") {
      error = readCodexErrorMessage(event) ?? error;
    }
  }

  return { text, error, usage };
}

function readCodexErrorMessage(event: Record<string, unknown>): string | undefined {
  if (typeof event.message === "string") {
    return event.message;
  }

  const nested = event.error as Record<string, unknown> | undefined;

  return typeof nested?.message === "string" ? nested.message : undefined;
}

function describeCodexFailure(detail: string, exitCode: number | null): string {
  const normalizedDetail = detail
    .replace(/Reading prompt from stdin\.\.\./g, "")
    .replace(/\s+/g, " ")
    .trim();
  const lowered = normalizedDetail.toLowerCase();

  if (lowered.includes("login") || lowered.includes("not logged in") || lowered.includes("401")) {
    return "Codex isn't signed in. Open a terminal, run `codex login`, then try again.";
  }

  if (lowered.includes("usage limit") || lowered.includes("rate limit")) {
    return `Codex reported a usage limit: ${truncate(normalizedDetail)}`;
  }

  if (normalizedDetail.length > 0) {
    return `Codex could not answer: ${truncate(normalizedDetail)}`;
  }

  return `Codex exited without an answer (code ${exitCode ?? "unknown"}).`;
}

function toCodexError(providerId: string, error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    return error;
  }

  if (error instanceof ProcessTimeoutError) {
    return new AiProviderError(providerId, "Codex did not answer in time. Try again.", { cause: error });
  }

  const message = error instanceof Error ? error.message : String(error);

  return new AiProviderError(providerId, `Mauz could not start Codex: ${message}`, { cause: error });
}

function truncate(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 237)}...`;
}
