import OpenAI, { APIConnectionError } from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { AskMauzRequest, AskMauzResponse, MauzDesktopContext, ScreenshotPayload } from "@mauzai/shared";
import { BackendUnreachableError, MissingOpenAIKeyError } from "../errors";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";
import { type BackendCapabilities, detectBackendCapabilities } from "../backend/capabilities";

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
};

export async function askMauz(
  request: AskMauzRequest,
  options: AskMauzOptions = {}
): Promise<AskMauzResponse> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.MAUZ_BACKEND_BASE_URL);
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
            content: MAUZ_SYSTEM_PROMPT
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

export function buildResponseContent(request: AskMauzRequest): ResponseInputMessageContentList {
  const content: ResponseInputMessageContentList = [
    {
      type: "input_text",
      text: buildContextText(request)
    }
  ];
  const cursorCrop = request.context.pointer?.cursorCrop;
  const screenshot =
    cursorCrop === undefined || shouldIncludeFullScreenshot()
      ? (request.context.pointer?.screenshot ?? request.context.screenshot)
      : undefined;

  if (cursorCrop !== undefined) {
    content.push({
      type: "input_image",
      image_url: toDataUrl(cursorCrop),
      detail: getScreenshotDetail()
    });
  }

  if (screenshot !== undefined) {
    content.push({
      type: "input_image",
      image_url: toDataUrl(screenshot),
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

export function shouldIncludeFullScreenshot(): boolean {
  return process.env.OPENAI_INCLUDE_FULL_SCREENSHOT === "true";
}

export function buildContextText(request: AskMauzRequest): string {
  const { question, context } = request;

  return [
    `User question: ${question}`,
    "",
    "Reference resolution priority: selected text > cursor-centered crop > active window metadata > full screenshot > cursor position.",
    "When the user says this, that, or here, use the cursor-centered crop as the pointed target unless selected text is available.",
    "",
    "Desktop context:",
    `- Timestamp: ${context.timestamp}`,
    `- Platform: ${context.platform}`,
    `- Cursor: (${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)})`,
    `- Selected text: ${formatSelectedText(context)}`,
    `- Pointer context: ${formatPointerContext(context)}`,
    `- Active app: ${formatActiveApp(context)}`,
    `- Active window: ${formatActiveWindow(context)}`,
    `- Screenshot: ${formatScreenshot(context)}`,
    "",
    "Previous conversation:",
    formatConversationMessages(request.conversationMessages)
  ].join("\n");
}

function formatConversationMessages(messages: AskMauzRequest["conversationMessages"]): string {
  if (messages === undefined || messages.length === 0) {
    return "none";
  }

  return messages
    .slice(-12)
    .map((message) => `${message.role === "user" ? "User" : "Mauz"}: ${message.content}`)
    .join("\n\n");
}

function toDataUrl(image: ScreenshotPayload): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function formatActiveApp(context: MauzDesktopContext): string {
  const activeApp = context.activeApp ?? context.pointer?.activeApp;

  if (activeApp === undefined) {
    return "unknown";
  }

  return [
    activeApp.name,
    activeApp.bundleId === undefined ? undefined : `bundle ${activeApp.bundleId}`,
    activeApp.processId === undefined ? undefined : `pid ${activeApp.processId}`
  ]
    .filter(Boolean)
    .join(", ");
}

function formatActiveWindow(context: MauzDesktopContext): string {
  const activeWindow = context.activeWindow ?? context.pointer?.activeWindow;

  if (activeWindow === undefined) {
    return "unknown";
  }

  const bounds = activeWindow.bounds;
  const boundsText =
    bounds === undefined
      ? undefined
      : `${Math.round(bounds.width)}x${Math.round(bounds.height)} at ${Math.round(bounds.x)},${Math.round(bounds.y)}`;

  return [activeWindow.title, boundsText].filter(Boolean).join(", ") || "unknown";
}

function formatSelectedText(context: MauzDesktopContext): string {
  const selectedText = context.selectedText ?? context.pointer?.selectedText;

  return selectedText?.trim() ? selectedText : "none provided";
}

function formatScreenshot(context: MauzDesktopContext): string {
  const cursorCrop = context.pointer?.cursorCrop;
  const screenshot = context.pointer?.screenshot ?? context.screenshot;

  if (screenshot === undefined) {
    return "none attached";
  }

  if (cursorCrop !== undefined && !shouldIncludeFullScreenshot()) {
    return `${screenshot.mimeType}, ${screenshot.width}x${screenshot.height}, captured locally but omitted from model image inputs for faster pointer asks`;
  }

  return `${screenshot.mimeType}, ${screenshot.width}x${screenshot.height}, attached as broad image input`;
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

function formatPointerContext(context: MauzDesktopContext): string {
  const pointer = context.pointer;

  if (pointer === undefined) {
    return "cursor coordinates only";
  }

  const displayBounds = pointer.display?.bounds;
  const displayText =
    displayBounds === undefined
      ? undefined
      : `display ${Math.round(displayBounds.width)}x${Math.round(displayBounds.height)} at ${Math.round(displayBounds.x)},${Math.round(displayBounds.y)}`;
  const cursorCrop =
    pointer.cursorCrop === undefined
      ? "no cursor crop"
      : `cursor-centered crop ${pointer.cursorCrop.mimeType}, ${pointer.cursorCrop.width}x${pointer.cursorCrop.height}, attached as first image input`;

  return [
    `cursor (${Math.round(pointer.cursor.x)}, ${Math.round(pointer.cursor.y)})`,
    displayText,
    cursorCrop
  ]
    .filter(Boolean)
    .join("; ");
}
