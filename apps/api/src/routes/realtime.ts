import type { FastifyInstance } from "fastify";
import {
  LOCAL_API_TOKEN_HEADER,
  RealtimeConnectRequestSchema,
  RealtimeConnectResponseSchema,
  type RealtimeConnectRequest,
  type RealtimeConnectResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { createRealtimeAnswer, type CreateRealtimeAnswerOptions } from "../openai/createRealtimeAnswer";
import type { OpenAiApiKeyProvider } from "./ask";

export type RealtimeConnectHandler = (
  request: RealtimeConnectRequest,
  options?: CreateRealtimeAnswerOptions
) => Promise<RealtimeConnectResponse>;

export type RegisterRealtimeRouteOptions = {
  realtimeConnectHandler?: RealtimeConnectHandler;
  openAiApiKeyProvider?: OpenAiApiKeyProvider;
  authToken?: string;
};

export async function registerRealtimeRoute(
  app: FastifyInstance,
  options: RegisterRealtimeRouteOptions = {}
): Promise<void> {
  const realtimeConnectHandler = options.realtimeConnectHandler ?? createRealtimeAnswer;

  app.post("/api/realtime/connect", async (request, reply) => {
    if (options.authToken !== undefined && request.headers[LOCAL_API_TOKEN_HEADER] !== options.authToken) {
      return reply.status(401).send({
        error: "Unauthorized local Mauz API request."
      });
    }

    const parsed = RealtimeConnectRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid Realtime connect request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    try {
      const apiKey = await options.openAiApiKeyProvider?.();
      const response = RealtimeConnectResponseSchema.parse(
        apiKey === undefined
          ? await realtimeConnectHandler(parsed.data)
          : await realtimeConnectHandler(parsed.data, { apiKey })
      );
      return reply.send(response);
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      return reply.status(502).send({
        error: "Realtime connection failed while contacting the model."
      });
    }
  });
}
