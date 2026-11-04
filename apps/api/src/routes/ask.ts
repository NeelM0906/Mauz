import type { FastifyInstance } from "fastify";
import {
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  LOCAL_API_TOKEN_HEADER,
  type AskAnswerDelta,
  type AskMauzRequest,
  type AskMauzResponse
} from "@mauzai/shared";
import {
  AgentRunStoppedError,
  AgentRunUnwatchableError,
  AiProviderError,
  BackendUnreachableError,
  MissingOpenAIKeyError,
  NoAiProviderError
} from "../errors";
import { askMauz } from "../openai/askMauz";
import { detectBackendCapabilities } from "../backend/capabilities";
import { askViaRuns, type RunLifecycleHooks } from "../backend/askViaRuns";

export type AskMauzHandler = (request: AskMauzRequest) => Promise<AskMauzResponse>;

export type AnswerStreamHooks = {
  /** Receives the answer text so far for requests that carry a requestId. */
  onAnswerText?(payload: AskAnswerDelta): void;
};

export type RegisterAskRouteOptions = {
  askHandler?: AskMauzHandler;
  authToken?: string;
  runHooks?: RunLifecycleHooks;
  answerHooks?: AnswerStreamHooks;
};

export async function registerAskRoute(
  app: FastifyInstance,
  options: RegisterAskRouteOptions = {}
): Promise<void> {
  const askHandler = options.askHandler ?? createDefaultAskHandler(options.runHooks, options.answerHooks);

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

      if (error instanceof BackendUnreachableError) {
        return reply.status(503).send({ error: error.message });
      }

      if (error instanceof AgentRunStoppedError) {
        return reply.status(499).send({ error: error.message });
      }

      if (error instanceof AgentRunUnwatchableError) {
        return reply.status(504).send({ error: error.message });
      }

      return reply.status(502).send({
        error: "Ask Mauz failed while contacting the model."
      });
    }
  });
}

export function createDefaultAskHandler(
  runHooks: RunLifecycleHooks | undefined,
  answerHooks?: AnswerStreamHooks
): AskMauzHandler {
  return async (request) => {
    const baseUrl = process.env.MAUZ_BACKEND_BASE_URL?.trim();

    if (baseUrl) {
      const capabilities = await detectBackendCapabilities(baseUrl);

      if (capabilities?.supportsRuns) {
        const backendApiKey = process.env.MAUZ_BACKEND_API_KEY?.trim();

        return askViaRuns(request, {
          baseUrl,
          model: resolveModelLabel(),
          agentMode: process.env.MAUZ_AGENT_MODE === "yolo" ? "yolo" : "approve",
          ...(backendApiKey ? { apiKey: backendApiKey } : {}),
          ...(process.env.MAUZ_INSTALL_ID ? { installId: process.env.MAUZ_INSTALL_ID } : {}),
          sessionKeyHeader: capabilities.sessionKeyHeader,
          ...runHooks
        });
      }
    }

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

function resolveModelLabel(): string {
  // The gateway uses its own model on the runs path, so the preset names the
  // answer more truthfully than the user's OpenAI ask model ever could.
  const preset = process.env.MAUZ_BACKEND_PRESET?.trim();
  if (preset && preset !== "openai" && preset !== "custom") {
    return `${preset}-agent`;
  }

  return process.env.OPENAI_ASK_MODEL?.trim() || "hermes-agent";
}
