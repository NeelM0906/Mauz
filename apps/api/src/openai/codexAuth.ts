import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AskMauzRequest, ChatTitleRequest, ScreenshotPayload } from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";
import { buildContextText, shouldIncludeFullScreenshot } from "./askMauz";

const CODEX_AUTH_MISSING_MESSAGE =
  "Sign in to OpenAI/ChatGPT in Codex, or switch Mauz OpenAI access to API key.";
const DEFAULT_CODEX_TIMEOUT_MS = 120_000;
const MAX_TITLE_SOURCE_CHARS = 1_400;

type CodexPromptOptions = {
  model: string;
  timeoutMs?: number;
};

type CodexImageInput = {
  name: string;
  image: ScreenshotPayload;
};

export async function askMauzWithChatGptAuth(
  request: AskMauzRequest,
  options: CodexPromptOptions
): Promise<string> {
  return runCodexPrompt({
    prompt: [MAUZ_SYSTEM_PROMPT, "", buildContextText(request)].join("\n"),
    model: options.model,
    images: getCodexImages(request),
    ...toTimeoutOption(options.timeoutMs)
  });
}

export async function generateChatTitleWithChatGptAuth(
  request: ChatTitleRequest,
  options: CodexPromptOptions
): Promise<string> {
  return runCodexPrompt({
    prompt: [
      "Generate a plain 3-7 word title for this Mauz desktop chat. No quotes, no punctuation-only title, no prefix.",
      "",
      "Question:",
      request.question.slice(0, MAX_TITLE_SOURCE_CHARS),
      "",
      "Answer:",
      request.answer.slice(0, MAX_TITLE_SOURCE_CHARS)
    ].join("\n"),
    model: options.model,
    ...toTimeoutOption(options.timeoutMs)
  });
}

function toTimeoutOption(timeoutMs: number | undefined): { timeoutMs: number } | {} {
  return timeoutMs === undefined ? {} : { timeoutMs };
}

async function runCodexPrompt({
  prompt,
  model,
  images,
  timeoutMs = DEFAULT_CODEX_TIMEOUT_MS
}: {
  prompt: string;
  model: string;
  images?: CodexImageInput[];
  timeoutMs?: number;
}): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "mauz-codex-"));
  const codexHome = await prepareCodexHome(workspace);
  const outputPath = join(workspace, "answer.txt");
  const imagePaths = await writeCodexImages(workspace, images ?? []);

  try {
    const result = await execCodex({
      prompt,
      model,
      codexHome,
      imagePaths,
      outputPath,
      timeoutMs
    });

    if (result.exitCode !== 0) {
      throwCodexError(result.stderr);
    }

    const answer = (await readFile(outputPath, "utf8")).trim();

    if (answer.length === 0) {
      throw new Error("ChatGPT auth returned an empty answer.");
    }

    return answer;
  } finally {
    await rm(workspace, {
      force: true,
      recursive: true
    });
  }
}

async function execCodex({
  prompt,
  model,
  codexHome,
  imagePaths,
  outputPath,
  timeoutMs
}: {
  prompt: string;
  model: string;
  codexHome: string;
  imagePaths: string[];
  outputPath: string;
  timeoutMs: number;
}): Promise<{ exitCode: number | null; stderr: string }> {
  const codexCliPath = getCodexCliPath();
  const codexArgs = buildCodexExecArgs({
    model,
    imagePaths,
    outputPath
  });

  return new Promise((resolve, reject) => {
    const child = spawn(codexCliPath, codexArgs, {
      cwd: codexHome,
      env: buildCodexEnv(codexHome),
      stdio: ["pipe", "ignore", "pipe"]
    });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("ChatGPT auth request timed out."));
    }, timeoutMs);

    child.stdin.end(prompt);
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if ("code" in error && error.code === "ENOENT") {
        reject(new MissingOpenAIKeyError("Codex CLI was not found. Install Codex or set CODEX_CLI_PATH."));
        return;
      }

      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        exitCode,
        stderr
      });
    });
  });
}

export function buildCodexExecArgs({
  model,
  imagePaths,
  outputPath
}: {
  model: string;
  imagePaths: string[];
  outputPath: string;
}): string[] {
  const args = [
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "-c",
    'approval_policy="never"',
    "--sandbox",
    "read-only",
    "--model",
    model,
    "--output-last-message",
    outputPath,
    "-"
  ];

  for (const imagePath of imagePaths) {
    args.splice(args.length - 1, 0, "--image", imagePath);
  }

  return args;
}

function buildCodexEnv(codexHome: string): NodeJS.ProcessEnv {
  return {
    CODEX_HOME: codexHome,
    HOME: codexHome,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    LC_ALL: process.env.LC_ALL ?? "en_US.UTF-8",
    LOGNAME: process.env.LOGNAME ?? "mauz",
    PATH: getSafePath(),
    TMPDIR: tmpdir(),
    USER: process.env.USER ?? "mauz"
  };
}

async function prepareCodexHome(workspace: string): Promise<string> {
  const codexHome = join(workspace, "codex-home");
  const sourceAuthPath = join(getSourceCodexHome(), "auth.json");

  await mkdir(codexHome, {
    recursive: true
  });

  if (existsSync(sourceAuthPath)) {
    await copyFile(sourceAuthPath, join(codexHome, "auth.json"));
  }

  return codexHome;
}

function getSourceCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function getCodexCliPath(): string {
  const configuredPath = process.env.CODEX_CLI_PATH?.trim();

  if (configuredPath) {
    return configuredPath;
  }

  for (const candidate of [
    "/Applications/Codex.app/Contents/Resources/codex",
    "/opt/homebrew/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex",
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex"
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return "codex";
}

function getSafePath(): string {
  return [
    "/Applications/Codex.app/Contents/Resources",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin"
  ].join(":");
}

async function writeCodexImages(workspace: string, images: CodexImageInput[]): Promise<string[]> {
  const imagePaths: string[] = [];

  for (const [index, input] of images.entries()) {
    const extension = input.image.mimeType === "image/png" ? "png" : "jpg";
    const imagePath = join(workspace, `${index}-${input.name}.${extension}`);

    await writeFile(imagePath, Buffer.from(input.image.base64, "base64"));
    imagePaths.push(imagePath);
  }

  return imagePaths;
}

export function getCodexImages(request: AskMauzRequest): CodexImageInput[] {
  const images: CodexImageInput[] = [];
  const cursorCrop = request.context.pointer?.cursorCrop;
  const screenshot =
    cursorCrop === undefined || shouldIncludeFullScreenshot()
      ? (request.context.pointer?.screenshot ?? request.context.screenshot)
      : undefined;

  if (cursorCrop !== undefined) {
    images.push({
      name: "cursor-crop",
      image: cursorCrop
    });
  }

  if (screenshot !== undefined) {
    images.push({
      name: "screenshot",
      image: screenshot
    });
  }

  return images;
}

function throwCodexError(stderr: string): never {
  if (/not logged in|log in|login|auth|api key|access token/i.test(stderr)) {
    throw new MissingOpenAIKeyError(CODEX_AUTH_MISSING_MESSAGE);
  }

  const normalized = stderr.trim();

  throw new Error(normalized.length > 0 ? `ChatGPT auth request failed: ${normalized}` : "ChatGPT auth request failed.");
}
