import OpenAI from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { AskMauzRequest, AskMauzResponse, MauzDesktopContext } from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";

const DEFAULT_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_SCREENSHOT_DETAIL = "auto";

export type AskMauzOptions = {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
};

export async function askMauz(
  request: AskMauzRequest,
  options: AskMauzOptions = {}
): Promise<AskMauzResponse> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_ASK_MODEL ?? DEFAULT_ASK_MODEL;

  if (!apiKey && options.client === undefined) {
    throw new MissingOpenAIKeyError();
  }

  const client = options.client ?? new OpenAI({ apiKey });
  const response = await client.responses.create({
    model,
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
  });
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

  if (request.context.screenshot !== undefined) {
    content.push({
      type: "input_image",
      image_url: `data:${request.context.screenshot.mimeType};base64,${request.context.screenshot.base64}`,
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

function buildContextText({ question, context }: AskMauzRequest): string {
  return [
    `User question: ${question}`,
    "",
    "Desktop context:",
    `- Timestamp: ${context.timestamp}`,
    `- Platform: ${context.platform}`,
    `- Cursor: (${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)})`,
    `- Active app: ${formatActiveApp(context)}`,
    `- Active window: ${formatActiveWindow(context)}`,
    `- Selected text: ${context.selectedText?.trim() ? context.selectedText : "none provided"}`,
    `- Screenshot: ${formatScreenshot(context)}`
  ].join("\n");
}

function formatActiveApp(context: MauzDesktopContext): string {
  if (context.activeApp === undefined) {
    return "unknown";
  }

  return [
    context.activeApp.name,
    context.activeApp.bundleId === undefined ? undefined : `bundle ${context.activeApp.bundleId}`,
    context.activeApp.processId === undefined ? undefined : `pid ${context.activeApp.processId}`
  ]
    .filter(Boolean)
    .join(", ");
}

function formatActiveWindow(context: MauzDesktopContext): string {
  if (context.activeWindow === undefined) {
    return "unknown";
  }

  const bounds = context.activeWindow.bounds;
  const boundsText =
    bounds === undefined
      ? undefined
      : `${Math.round(bounds.width)}x${Math.round(bounds.height)} at ${Math.round(bounds.x)},${Math.round(bounds.y)}`;

  return [context.activeWindow.title, boundsText].filter(Boolean).join(", ") || "unknown";
}

function formatScreenshot(context: MauzDesktopContext): string {
  if (context.screenshot === undefined) {
    return "none attached";
  }

  return `${context.screenshot.mimeType}, ${context.screenshot.width}x${context.screenshot.height}, attached as image input`;
}
