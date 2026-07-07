import Fastify, { type FastifyInstance } from "fastify";
import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { registerAskRoute, type AskMauzHandler } from "./routes/ask";
import type { RunLifecycleHooks } from "./backend/askViaRuns";
import { registerChatTitleRoute, type ChatTitleHandler } from "./routes/chatTitle";
import { registerHealthzRoute } from "./routes/healthz";
import { registerRealtimeRoute, type RealtimeConnectHandler } from "./routes/realtime";

export type {
  RunLifecycleHooks,
  AgentApprovalRequest,
  AgentApprovalChoice,
  RunActivityEvent
} from "./backend/askViaRuns";
export { stopRun } from "./backend/runsClient";
export type { RunsClientOptions } from "./backend/runsClient";

export type CreateMauzApiServerOptions = {
  askHandler?: AskMauzHandler;
  chatTitleHandler?: ChatTitleHandler;
  realtimeConnectHandler?: RealtimeConnectHandler;
  authToken?: string;
  logger?: boolean;
  loadEnv?: boolean;
  runHooks?: RunLifecycleHooks;
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
    ...(options.runHooks === undefined ? {} : { runHooks: options.runHooks })
  });
  await registerChatTitleRoute(app, {
    ...(options.chatTitleHandler === undefined ? {} : { chatTitleHandler: options.chatTitleHandler }),
    ...(options.authToken === undefined ? {} : { authToken: options.authToken })
  });
  await registerRealtimeRoute(app, {
    ...(options.realtimeConnectHandler === undefined
      ? {}
      : { realtimeConnectHandler: options.realtimeConnectHandler }),
    ...(options.authToken === undefined ? {} : { authToken: options.authToken })
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
