import type { FastifyInstance } from "fastify";
import {
  ChatTitleRequestSchema,
  ChatTitleResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type ChatTitleRequest,
  type ChatTitleResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { generateChatTitle } from "../openai/generateChatTitle";

export type ChatTitleHandler = (request: ChatTitleRequest) => Promise<ChatTitleResponse>;

export type RegisterChatTitleRouteOptions = {
  chatTitleHandler?: ChatTitleHandler;
  authToken?: string;
};

export async function registerChatTitleRoute(
  app: FastifyInstance,
  options: RegisterChatTitleRouteOptions = {}
): Promise<void> {
  const chatTitleHandler = options.chatTitleHandler ?? generateChatTitle;

  app.post("/api/chat/title", async (request, reply) => {
    if (options.authToken !== undefined && request.headers[LOCAL_API_TOKEN_HEADER] !== options.authToken) {
      return reply.status(401).send({
        error: "Unauthorized local Mauz API request."
      });
    }

    const parsed = ChatTitleRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid chat title request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    try {
      const response = ChatTitleResponseSchema.parse(await chatTitleHandler(parsed.data));
      return reply.send(response);
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      return reply.status(502).send({
        error: "Chat title generation failed while contacting the model."
      });
    }
  });
}
