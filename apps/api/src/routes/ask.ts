import type { FastifyInstance } from "fastify";
import {
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  type AskMauzRequest,
  type AskMauzResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { askMauz } from "../openai/askMauz";

export type AskMauzHandler = (request: AskMauzRequest) => Promise<AskMauzResponse>;

export type RegisterAskRouteOptions = {
  askHandler?: AskMauzHandler;
};

export async function registerAskRoute(
  app: FastifyInstance,
  options: RegisterAskRouteOptions = {}
): Promise<void> {
  const askHandler = options.askHandler ?? askMauz;

  app.post("/api/ask", async (request, reply) => {
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
      const response = AskMauzResponseSchema.parse(await askHandler(parsed.data));
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
