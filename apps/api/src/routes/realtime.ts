import type { FastifyInstance } from "fastify";
import {
  LOCAL_API_TOKEN_HEADER,
  RealtimeConnectRequestSchema,
  RealtimeConnectResponseSchema,
  type RealtimeConnectRequest,
  type RealtimeConnectResponse
} from "@mauzai/shared";
import { MissingOpenAIKeyError, OpenAIRealtimeConnectionError } from "../errors";
import { createRealtimeAnswer } from "../openai/createRealtimeAnswer";

export type RealtimeConnectHandler = (request: RealtimeConnectRequest) => Promise<RealtimeConnectResponse>;

export type RegisterRealtimeRouteOptions = {
  realtimeConnectHandler?: RealtimeConnectHandler;
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
      const response = RealtimeConnectResponseSchema.parse(await realtimeConnectHandler(parsed.data));
      return reply.status(201).send(response);
    } catch (error) {
      if (error instanceof MissingOpenAIKeyError) {
        return reply.status(503).send({
          error: error.message
        });
      }

      if (error instanceof OpenAIRealtimeConnectionError) {
        return reply.status(toLocalRealtimeStatus(error)).send({
          error: error.message,
          ...(error.code === undefined ? {} : { code: error.code }),
          ...(error.type === undefined ? {} : { type: error.type }),
          ...(error.param === undefined ? {} : { param: error.param })
        });
      }

      return reply.status(502).send({
        error: "Realtime connection failed while contacting the model."
      });
    }
  });
}

function toLocalRealtimeStatus(error: OpenAIRealtimeConnectionError): number {
  if (error.status === 401) {
    return 503;
  }

  if (error.status === 429) {
    return 429;
  }

  return 502;
}
