import OpenAI, { APIConnectionError } from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";
import {
  formatScreenBlock,
  getContextImage,
  type AskMauzRequest,
  type AskMauzResponse,
  type ScreenshotPayload
} from "@mauzai/shared";
import { BackendUnreachableError, MissingOpenAIKeyError } from "../errors";
import { getSystemPromptFor } from "../prompts/mauzSystemPrompt";
import { type BackendCapabilities, detectBackendCapabilities } from "../backend/capabilities";
import {
  answerWithFallback,
  getDefaultAnswerProviderRegistry,
  type AnswerProviderRegistry
} from "../providers/registry";
import type { AnswerImage, AnswerPrompt } from "../providers/types";

const DEFAULT_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_SCREENSHOT_DETAIL = "auto";
const DEFAULT_ASK_MAX_OUTPUT_TOKENS = 700;

export type AskMauzOptions = {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
  baseUrl?: string;
  backendApiKey?: string;
  installId?: string;
  fetchImpl?: typeof fetch;
  registry?: Pick<AnswerProviderRegistry, "resolve">;
  onText?: (textSoFar: string) => void;
  signal?: AbortSignal;
};

export async function askMauz(
  request: AskMauzRequest,
  options: AskMauzOptions = {}
): Promise<AskMauzResponse> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.MAUZ_BACKEND_BASE_URL);

  // Without a gateway or an explicit OpenAI client, answer with the provider the user
  // configured or signed in to (API key or Claude Code / Codex subscription).
  if (baseUrl === undefined && options.client === undefined && options.apiKey === undefined) {
    return askWithAnswerProvider(request, options);
  }

  const backendApiKey = options.backendApiKey ?? process.env.MAUZ_BACKEND_API_KEY?.trim() ?? undefined;
  const installId = options.installId ?? process.env.MAUZ_INSTALL_ID?.trim() ?? undefined;
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_ASK_MODEL ?? DEFAULT_ASK_MODEL;

  if (baseUrl === undefined && !apiKey && options.client === undefined) {
    throw new MissingOpenAIKeyError();
  }

  const client =
    options.client ??
    (baseUrl === undefined
      ? new OpenAI({ apiKey })
      : // maxRetries: 0 is intentional — fail fast so a down local backend surfaces BackendUnreachableError immediately instead of retrying.
        new OpenAI({ apiKey: backendApiKey || "mauz-local-backend", baseURL: baseUrl, maxRetries: 0 }));

  const capabilities =
    baseUrl === undefined ? null : await detectBackendCapabilities(baseUrl, options.fetchImpl ?? fetch);
  const headers = buildBackendHeaders(capabilities, request.sessionId, backendApiKey ? installId : undefined);

  let response: Awaited<ReturnType<typeof client.responses.create>>;
  try {
    response = await client.responses.create(
      {
        model,
        store: false,
        max_output_tokens: getAskMaxOutputTokens(),
        input: [
          {
            role: "system",
            content: getSystemPromptFor(request)
          },
          {
            role: "user",
            content: buildResponseContent(request)
          }
        ]
      },
      Object.keys(headers).length > 0 ? { headers } : undefined
    );
  } catch (error) {
    if (baseUrl !== undefined && isConnectionError(error)) {
      throw new BackendUnreachableError(baseUrl, { cause: error });
    }
    throw error;
  }
  const answer = response.output_text?.trim();

  if (answer === undefined || answer.length === 0) {
    throw new Error("Mauz did not return a text answer.");
  }

  return {
    answer,
    model,
    ...(response.usage === undefined ? {} : { usage: response.usage })
  };
}

async function askWithAnswerProvider(
  request: AskMauzRequest,
  options: AskMauzOptions
): Promise<AskMauzResponse> {
  const registry = options.registry ?? getDefaultAnswerProviderRegistry();
  const providers = await registry.resolve();
  const result = await answerWithFallback(providers, buildAnswerPrompt(request), {
    onText: options.onText,
    signal: options.signal
  });

  return {
    answer: result.text,
    model: toModelLabel(result.model),
    ...(result.usage === undefined ? {} : { usage: result.usage })
  };
}

/** Provider-neutral prompt: system prompt, context text, and labeled images in send order. */
export function buildAnswerPrompt(request: AskMauzRequest): AnswerPrompt {
  const image = getContextImage(request.context);
  const images: AnswerImage[] =
    image === undefined
      ? []
      : [
          { mimeType: image.payload.mimeType, base64: image.payload.base64, label: `Image 1: ${image.label}` }
        ];

  return {
    systemPrompt: getSystemPromptFor(request),
    userText: buildContextText(request),
    images
  };
}

function toModelLabel(model: string): string {
  const label = model
    .trim()
    .replace(/[^A-Za-z0-9._:/-]+/g, "-")
    .slice(0, 128);

  return label.length > 0 ? label : "unknown-model";
}

export function buildResponseContent(request: AskMauzRequest): ResponseInputMessageContentList {
  const content: ResponseInputMessageContentList = [
    {
      type: "input_text",
      text: buildContextText(request)
    }
  ];
  const image = getContextImage(request.context);

  if (image !== undefined) {
    content.push({
      type: "input_image",
      image_url: toDataUrl(image.payload),
      detail: getScreenshotDetail()
    });
  }

  return content;
}

function getScreenshotDetail(): "auto" | "low" | "high" {
  const configured = process.env.OPENAI_SCREENSHOT_DETAIL;

  if (configured === "auto" || configured === "low" || configured === "high") {
    return configured;
  }

  return DEFAULT_SCREENSHOT_DETAIL;
}

function getAskMaxOutputTokens(): number {
  const configured = Number.parseInt(
    process.env.OPENAI_ASK_MAX_OUTPUT_TOKENS ?? String(DEFAULT_ASK_MAX_OUTPUT_TOKENS),
    10
  );

  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_ASK_MAX_OUTPUT_TOKENS;
}

export function buildContextText(request: AskMauzRequest): string {
  const image = getContextImage(request.context);
  const sections = [
    `<question>\n${request.question.trim()}\n</question>`,
    formatScreenBlock(request.context, image === undefined ? undefined : `attached: ${image.label}`)
  ];
  const conversation = formatConversationMessages(request.conversationMessages);

  if (conversation !== undefined) {
    sections.push(`<previous_conversation>\n${conversation}\n</previous_conversation>`);
  }

  return sections.join("\n\n");
}

function formatConversationMessages(messages: AskMauzRequest["conversationMessages"]): string | undefined {
  if (messages === undefined || messages.length === 0) {
    return undefined;
  }

  return messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "User" : "Mauz"}: ${message.content}`)
    .join("\n\n");
}

function toDataUrl(image: ScreenshotPayload): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed.replace(/\/+$/, "") : undefined;
}

function buildBackendHeaders(
  capabilities: BackendCapabilities | null,
  sessionId: string | undefined,
  installId: string | undefined
): Record<string, string> {
  if (capabilities === null) {
    return {};
  }
  return {
    ...(sessionId === undefined ? {} : { [capabilities.sessionIdHeader]: sessionId }),
    ...(installId === undefined ? {} : { [capabilities.sessionKeyHeader]: installId })
  };
}

function isConnectionError(error: unknown): boolean {
  if (error instanceof APIConnectionError) {
    return true;
  }
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if ("name" in error && error.name === "APIConnectionError") {
    return true;
  }
  return "cause" in error && isConnectionError((error as { cause: unknown }).cause);
}
