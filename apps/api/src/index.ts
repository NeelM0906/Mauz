import { DEFAULT_MAUZ_API_PORT } from "@mauzai/shared";
import { createMauzApiServer } from "./server";

const port = Number.parseInt(process.env.MAUZ_API_PORT ?? String(DEFAULT_MAUZ_API_PORT), 10);
const authToken = process.env.MAUZ_LOCAL_API_TOKEN?.trim();
const allowUnauthenticated = process.env.MAUZ_API_ALLOW_UNAUTHENTICATED === "true";

if (!authToken && !allowUnauthenticated) {
  throw new Error(
    "Set MAUZ_LOCAL_API_TOKEN for the standalone Mauz API, or set MAUZ_API_ALLOW_UNAUTHENTICATED=true for local development only."
  );
}

const app = await createMauzApiServer({
  ...(authToken ? { authToken } : {})
});

await app.listen({
  host: "127.0.0.1",
  port
});
