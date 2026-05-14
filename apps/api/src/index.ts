import { DEFAULT_MAUZ_API_PORT } from "@mauzai/shared";
import { createMauzApiServer } from "./server";

const port = Number.parseInt(process.env.MAUZ_API_PORT ?? String(DEFAULT_MAUZ_API_PORT), 10);
const app = await createMauzApiServer();

await app.listen({
  host: "127.0.0.1",
  port
});
