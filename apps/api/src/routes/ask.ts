import type { FastifyInstance } from "fastify";
import {
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type AskMauzRequest,
  type AskMauzResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { askMauz, type AskMauzOptions } from "../openai/askMauz";

export type OpenAiApiKeyProvider = () => Promise<string | undefined> | string | undefined;
export type AskMauzHandler = (request: AskMauzRequest, options?: AskMauzOptions) => Promise<AskMauzResponse>;

export type RegisterAskRouteOptions = {
  askHandler?: AskMauzHandler;
  openAiApiKeyProvider?: OpenAiApiKeyProvider;
  authToken?: string;
};

export async function registerAskRoute(
  app: FastifyInstance,
  options: RegisterAskRouteOptions = {}
): Promise<void> {
  const askHandler = options.askHandler ?? askMauz;

  app.post("/api/ask", async (request, reply) => {
    if (options.authToken !== undefined && request.headers[LOCAL_API_TOKEN_HEADER] !== options.authToken) {
      return reply.status(401).send({
        error: "Unauthorized local Mauz API request."
      });
    }

    const parsed = AskMauzRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid Ask Mauz request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    try {
      const apiKey = await options.openAiApiKeyProvider?.();
      const response = AskMauzResponseSchema.parse(
        apiKey === undefined ? await askHandler(parsed.data) : await askHandler(parsed.data, { apiKey })
      );
      return reply.send(response);
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      return reply.status(502).send({
        error: "Ask Mauz failed while contacting the model."
      });
    }
  });
}
