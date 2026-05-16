import type { FastifyInstance } from "fastify";
import {
  LOCAL_API_TOKEN_HEADER,
  RealtimeConnectRequestSchema,
  type RealtimeConnectRequest,
  type RealtimeConnectResponse
} from "@mauzai/shared";

export type RealtimeConnectHandler = (request: RealtimeConnectRequest) => Promise<RealtimeConnectResponse>;

export type RegisterRealtimeRouteOptions = {
  realtimeConnectHandler?: RealtimeConnectHandler;
  authToken?: string;
};

const FEATURE_UNAVAILABLE_MESSAGE = "Still working on this.";

export async function registerRealtimeRoute(
  app: FastifyInstance,
  options: RegisterRealtimeRouteOptions = {}
): Promise<void> {
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

    return reply.status(501).send({
      error: FEATURE_UNAVAILABLE_MESSAGE
    });
  });
}
