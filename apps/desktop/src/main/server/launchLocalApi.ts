import { createMauzApiServer } from "@mauzai/api/server";
import { DEFAULT_MAUZ_API_PORT } from "@mauzai/shared";

export type LocalApiHandle = {
  baseUrl: string;
  stop(): Promise<void>;
};

export async function launchLocalApi(): Promise<LocalApiHandle> {
  const app = await createMauzApiServer();
  const configuredPort = Number.parseInt(process.env.MAUZ_API_PORT ?? String(DEFAULT_MAUZ_API_PORT), 10);
  const port = Number.isFinite(configuredPort) ? configuredPort : DEFAULT_MAUZ_API_PORT;

  await app.listen({
    host: "127.0.0.1",
    port
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async stop(): Promise<void> {
      await app.close();
    }
  };
}
