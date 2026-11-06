import Fastify, { type FastifyInstance } from "fastify";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AiProvidersStatusResponse, SubscriptionConnectState } from "@mauzai/shared";
import { registerAskRoute, type AnswerStreamHooks, type AskMauzHandler } from "./routes/ask";
import { MAUZ_SYSTEM_PROMPT } from "./prompts/mauzSystemPrompt";
import { getDefaultAnswerProviderRegistry, resolveCliCommandForMauz } from "./providers/registry";
import { SubscriptionConnector } from "./providers/subscriptionConnect";
import { registerHealthzRoute } from "./routes/healthz";

export type { AnswerStreamHooks } from "./routes/ask";
export { hasOpenAiTranscription, transcribeWithOpenAi } from "./openai/transcribeAudio";

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

export type CreateMauzApiServerOptions = {
  askHandler?: AskMauzHandler;
  authToken?: string;
  logger?: boolean;
  loadEnv?: boolean;
  answerHooks?: AnswerStreamHooks;
};

export async function createMauzApiServer(
  options: CreateMauzApiServerOptions = {}
): Promise<FastifyInstance> {
  if (options.loadEnv ?? true) {
    loadLocalEnv();
  }

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 32 * 1024 * 1024
  });

  await registerHealthzRoute(app);
  await registerAskRoute(app, {
    ...(options.askHandler === undefined ? {} : { askHandler: options.askHandler }),
    ...(options.authToken === undefined ? {} : { authToken: options.authToken }),
    ...(options.answerHooks === undefined ? {} : { answerHooks: options.answerHooks })
  });

  return app;
}

function loadLocalEnv(): void {
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
