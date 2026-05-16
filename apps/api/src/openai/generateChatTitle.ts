import OpenAI from "openai";
import type { ChatTitleRequest, ChatTitleResponse } from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../errors";

const DEFAULT_CHAT_TITLE_MODEL = "gpt-5.4-nano";
const MAX_TITLE_SOURCE_CHARS = 1_400;

export type GenerateChatTitleOptions = {
  apiKey?: string;
  model?: string;
  client?: OpenAI;
};

export async function generateChatTitle(
  request: ChatTitleRequest,
  options: GenerateChatTitleOptions = {}
): Promise<ChatTitleResponse> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.OPENAI_CHAT_TITLE_MODEL ?? DEFAULT_CHAT_TITLE_MODEL;

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
        content:
          "Generate a plain 3-7 word title for this Mauz desktop chat. No quotes, no punctuation-only title, no prefix."
      },
      {
        role: "user",
        content: buildTitleSource(request)
      }
    ]
  });
  const title = normalizeChatTitle(response.output_text ?? "");

  if (title.length === 0) {
    throw new Error("Mauz could not generate a chat title.");
  }

  return {
    title,
    model
  };
}

export function buildFallbackChatTitle(question: string): string {
  const normalized = normalizeChatTitle(question);

  return normalized.length > 0 ? normalized : "Untitled Mauz Chat";
}

export function normalizeChatTitle(title: string): string {
  const words = title
    .replace(/["'`]/g, "")
    .replace(/[.,:;!?()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 7);

  if (words.length === 0) {
    return "";
  }

  return words.join(" ");
}

function buildTitleSource({ question, answer }: ChatTitleRequest): string {
  return [
    "Question:",
    question.slice(0, MAX_TITLE_SOURCE_CHARS),
    "",
    "Answer:",
    answer.slice(0, MAX_TITLE_SOURCE_CHARS)
  ].join("\n");
}
