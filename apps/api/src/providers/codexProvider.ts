import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AiProviderError } from "../errors";
import { buildCliEnvironment, resolveCliCommand } from "./cliCommand";
import {
  describeCliFailure,
  parseJsonLine,
  runAndCollect,
  spawnCliProcess,
  toCliError,
  type AskCli
} from "./processRunner";
import type { AskOptions, AskPrompt, AskProvider, AskResult } from "./types";

const DEFAULT_CODEX_REASONING_EFFORT = "low";
const ASK_TIMEOUT_MS = 180_000;
const CODEX_CLI: AskCli = {
  label: "Codex",
  signInKeywords: ["login", "not logged in", "401"],
  signInMessage: "Codex isn't signed in. Open a terminal, run `codex login`, then try again."
};

type CodexProviderOptions = {
  env?: () => NodeJS.ProcessEnv;
};

/**
 * Answers through the user's signed-in Codex CLI (their ChatGPT subscription). Runs
 * ephemeral, read-only, outside any repository, and ignores the user's Codex config so
 * their MCP servers and plugins never see Mauz prompts.
 */
export class CodexProvider implements AskProvider {
  readonly id = "codex" as const;
  private readonly readEnv: () => NodeJS.ProcessEnv;

  constructor(options: CodexProviderOptions = {}) {
    this.readEnv = options.env ?? (() => process.env);
  }

  async answer(prompt: AskPrompt, options: AskOptions = {}): Promise<AskResult> {
    const env = this.readEnv();
    const command = resolveCliCommand("codex", {
      env,
      fallbackNodeRuntime: process.versions.electron === undefined ? undefined : process.execPath
    });

    if (command === null) {
      throw new AiProviderError(
        this.id,
        "Codex is not installed. Install it with `npm install -g @openai/codex`, run `codex login`, then try again."
      );
    }

    const workingDirectory = await mkdtemp(join(tmpdir(), "mauz-codex-"));

    try {
      const imagePaths = await writeImages(workingDirectory, prompt);
      const model = env.MAUZ_CODEX_MODEL?.trim() || undefined;
      const reasoningEffort = env.MAUZ_CODEX_REASONING_EFFORT?.trim() || DEFAULT_CODEX_REASONING_EFFORT;
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
        `model_reasoning_effort="${reasoningEffort}"`,
        ...(model === undefined ? [] : ["--model", model]),
        ...imagePaths.flatMap((imagePath) => ["--image", imagePath]),
        "-"
      ];
      const child = spawnCliProcess(command.command, args, {
        cwd: workingDirectory,
        env: { ...buildCliEnvironment(env), ...command.env }
      });
      const output = await runAndCollect(child, {
        stdinText: buildCodexPrompt(prompt),
        timeoutMs: ASK_TIMEOUT_MS
      }).catch((error: unknown) => {
        throw toCliError(this.id, CODEX_CLI.label, error);
      });
      const parsed = parseCodexOutput(output.stdout);

      if (parsed.text.length > 0) {
        options.onText?.(parsed.text);
        return { text: parsed.text };
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

async function writeImages(directory: string, prompt: AskPrompt): Promise<string[]> {
  const paths: string[] = [];

  for (const [index, image] of prompt.images.entries()) {
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    const path = join(directory, `mauz-image-${index + 1}.${extension}`);
    await writeFile(path, Buffer.from(image.base64, "base64"));
    paths.push(path);
  }

  return paths;
}

function buildCodexPrompt(prompt: AskPrompt): string {
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
};

export function parseCodexOutput(stdout: string): ParsedCodexOutput {
  let text = "";
  let error: string | undefined;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const event = parseJsonLine(rawLine.trim());

    if (event === null) {
      continue;
    }

    const item = event.item as Record<string, unknown> | undefined;

    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      text = item.text.trim();
    } else if (event.type === "turn.failed" || event.type === "error") {
      error = readCodexErrorMessage(event) ?? error;
    }
  }

  return { text, error };
}

function readCodexErrorMessage(event: Record<string, unknown>): string | undefined {
  if (typeof event.message === "string") {
    return event.message;
  }

  const nested = event.error as Record<string, unknown> | undefined;

  return typeof nested?.message === "string" ? nested.message : undefined;
}

/** Codex prints "Reading prompt from stdin..." on every run; it is not part of the error. */
export function describeCodexFailure(detail: string, exitCode: number | null): string {
  return describeCliFailure(CODEX_CLI, detail.replace(/Reading prompt from stdin\.\.\./g, ""), exitCode);
}
