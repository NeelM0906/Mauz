import OpenAI from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";
import type { AskMauzRequest, AskMauzResponse, MauzDesktopContext, ScreenshotPayload } from "@mauzai/shared";
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
    store: false,
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
  const cursorCrop = request.context.pointer?.cursorCrop;
  const screenshot = request.context.pointer?.screenshot ?? request.context.screenshot;

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

export function buildContextText({ question, context }: AskMauzRequest): string {
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
    `- Pointer context: ${formatPointerContext(context)}`,
    `- Active app: ${formatActiveApp(context)}`,
    `- Active window: ${formatActiveWindow(context)}`,
    `- Selected text: ${context.selectedText?.trim() ? context.selectedText : "none provided"}`,
    `- Screenshot: ${formatScreenshot(context)}`
  ].join("\n");
}

function toDataUrl(image: ScreenshotPayload): string {
  return `data:${image.mimeType};base64,${image.base64}`;
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
  const screenshot = context.pointer?.screenshot ?? context.screenshot;

  if (screenshot === undefined) {
    return "none attached";
  }

  return `${screenshot.mimeType}, ${screenshot.width}x${screenshot.height}, attached as broad image input`;
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
