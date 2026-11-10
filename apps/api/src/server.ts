import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AskMauzResponseSchema,
  type AiProvidersStatusResponse,
  type AskMauzRequest,
  type AskMauzResponse,
  type SubscriptionConnectState
} from "@mauzai/shared";
import { AiProviderError, MissingOpenAIKeyError, NoAiProviderError } from "./errors";
import { askMauz } from "./openai/askMauz";
import { MAUZ_SYSTEM_PROMPT } from "./prompts/mauzSystemPrompt";
import { getDefaultAnswerProviderRegistry, resolveCliCommandForMauz } from "./providers/registry";
import { SubscriptionConnector } from "./providers/subscriptionConnect";

export { hasOpenAiTranscription, transcribeWithOpenAi } from "./openai/transcribeAudio";
export { applyCliPathOverride, buildCliEnvironment, getCliSearchDirectories } from "./providers/cliCommand";

/** Detects which AI providers (API keys, Claude Code, Codex) can answer right now. */
export function getAiProvidersStatus(
  options: { refresh?: boolean } = {}
): Promise<AiProvidersStatusResponse> {
  return getDefaultAnswerProviderRegistry().getStatus(options);
}

/** Starts slow provider setup (for example the Claude Code CLI) when a question is likely. */
export function prewarmAnswerProvider(): void {
  getDefaultAnswerProviderRegistry().prewarm(MAUZ_SYSTEM_PROMPT);
}

/**
 * Connects Claude Code or Codex subscriptions from inside Mauz (install the CLI if needed, then
 * run its sign-in). Successful sign-ins refresh provider detection.
 */
export function createSubscriptionConnector(
  onState: (state: SubscriptionConnectState) => void
): SubscriptionConnector {
  return new SubscriptionConnector({
    resolveCommand: resolveCliCommandForMauz,
    onAuthChanged: () => getDefaultAnswerProviderRegistry().getStatus({ refresh: true }),
    onState
  });
}

export type { SubscriptionConnector } from "./providers/subscriptionConnect";

export function disposeAnswerProviders(): void {
  getDefaultAnswerProviderRegistry().dispose();
}

/**
 * Answers an Ask request with the user's provider. onText receives the answer text so far.
 * Provider errors keep their message; any other failure gets one generic message.
 */
export async function answerAsk(
  request: AskMauzRequest,
  onText?: (text: string) => void
): Promise<AskMauzResponse> {
  try {
    return AskMauzResponseSchema.parse(await askMauz(request, onText === undefined ? {} : { onText }));
  } catch (error) {
    if (
      error instanceof NoAiProviderError ||
      error instanceof MissingOpenAIKeyError ||
      error instanceof AiProviderError
    ) {
      throw error;
    }

    throw new Error("Ask Mauz failed while contacting the model.");
  }
}

/** Loads `.env.local` and `.env` from the working folder and its parents. Set variables win. */
export function loadLocalEnv(): void {
  for (const envPath of getEnvCandidates()) {
    if (existsSync(envPath)) {
      loadDotenv({ path: envPath, override: false, quiet: true });
    }
  }
}

function getEnvCandidates(): string[] {
  const candidates = new Set<string>();
  let currentDir = process.cwd();

  for (let depth = 0; depth < 4; depth += 1) {
    candidates.add(resolve(currentDir, ".env.local"));
    candidates.add(resolve(currentDir, ".env"));

    const parent = dirname(currentDir);

    if (parent === currentDir) {
      break;
    }

    currentDir = parent;
  }

  return [...candidates];
}
