import { createMauzApiServer } from "@mauzai/api/server";
import { DEFAULT_MAUZ_API_PORT } from "@mauzai/shared";
import type { OpenAiApiKeyProvider } from "@mauzai/api/server";

export type LocalApiHandle = {
  baseUrl: string;
  port: number;
  stop(): Promise<void>;
};

export type LaunchLocalApiOptions = {
  authToken: string;
  openAiApiKeyProvider?: OpenAiApiKeyProvider;
  maxPortAttempts?: number;
};

const DEFAULT_MAX_PORT_ATTEMPTS = 20;

export async function launchLocalApi(options: LaunchLocalApiOptions): Promise<LocalApiHandle> {
  const candidatePorts = getLocalApiPortCandidates(options.maxPortAttempts);
  let lastError: unknown;

  for (const port of candidatePorts) {
    const app = await createMauzApiServer({
      authToken: options.authToken,
      ...(options.openAiApiKeyProvider === undefined
        ? {}
        : { openAiApiKeyProvider: options.openAiApiKeyProvider })
    });

    try {
      await app.listen({
        host: "127.0.0.1",
        port
      });

      return {
        baseUrl: `http://127.0.0.1:${port}`,
        port,
        async stop(): Promise<void> {
          await app.close();
        }
      };
    } catch (error) {
      await app.close();

      if (!isPortUnavailable(error)) {
        throw error;
      }

      lastError = error;
    }
  }

  throw lastError ?? new Error("No Mauz local API ports were available.");
}

export function getConfiguredLocalApiPort(): number {
  const configuredPort = Number.parseInt(process.env.MAUZ_API_PORT ?? String(DEFAULT_MAUZ_API_PORT), 10);

  return Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : DEFAULT_MAUZ_API_PORT;
}

export function getLocalApiPortCandidates(maxAttempts = DEFAULT_MAX_PORT_ATTEMPTS): number[] {
  const startPort = getConfiguredLocalApiPort();
  const attempts = Math.max(1, Math.floor(maxAttempts));

  return Array.from({ length: attempts }, (_value, index) => startPort + index).filter(
    (port) => port <= 65_535
  );
}

export function isPortUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "EADDRINUSE") {
    return true;
  }

  return "cause" in error && isPortUnavailable(error.cause);
}
