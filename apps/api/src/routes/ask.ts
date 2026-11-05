import type { FastifyInstance } from "fastify";
import {
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type AskAnswerDelta,
  type AskMauzRequest,
  type AskMauzResponse
} from "@mauzai/shared";
import { AiProviderError, MissingOpenAIKeyError, NoAiProviderError } from "../errors";
import { askMauz } from "../openai/askMauz";

export type AskMauzHandler = (request: AskMauzRequest) => Promise<AskMauzResponse>;

export type AnswerStreamHooks = {
  /** Receives the answer text so far for requests that carry a requestId. */
  onAnswerText?(payload: AskAnswerDelta): void;
};

export type RegisterAskRouteOptions = {
  askHandler?: AskMauzHandler;
  authToken?: string;
  answerHooks?: AnswerStreamHooks;
};

export async function registerAskRoute(
  app: FastifyInstance,
  options: RegisterAskRouteOptions = {}
): Promise<void> {
  const askHandler = options.askHandler ?? createDefaultAskHandler(options.answerHooks);

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
      const response = AskMauzResponseSchema.parse(await askHandler(parsed.data));
      return reply.send(response);
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError || error instanceof NoAiProviderError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      if (error instanceof AiProviderError) {
        return reply.status(502).send({ error: error.message });
      }

      return reply.status(502).send({
        error: "Ask Mauz failed while contacting the model."
      });
    }
  });
}

/** Ask always answers with the user's General AI provider. */
export function createDefaultAskHandler(answerHooks?: AnswerStreamHooks): AskMauzHandler {
  return async (request) => {
    const requestId = request.requestId;
    const onAnswerText = answerHooks?.onAnswerText;

    return askMauz(
      request,
      requestId !== undefined && onAnswerText !== undefined
        ? { onText: (text) => onAnswerText({ requestId, text }) }
        : {}
    );
  };
}
