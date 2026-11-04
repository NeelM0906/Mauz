import OpenAI from "openai";
import type { ResponseInputMessageContentList } from "openai/resources/responses/responses";
import { AiProviderError, MissingOpenAIKeyError } from "../errors";
import type { AnswerOptions, AnswerPrompt, AnswerProvider, AnswerResult } from "./types";

export const DEFAULT_OPENAI_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_ASK_MAX_OUTPUT_TOKENS = 700;

type OpenAiClientLike = Pick<OpenAI, "responses">;

export type OpenAiApiProviderOptions = {
  env?: () => NodeJS.ProcessEnv;
  createClient?: (apiKey: string) => OpenAiClientLike;
};

/** Answers with the user's own OpenAI API key through the Responses API. */
export class OpenAiApiProvider implements AnswerProvider {
  readonly id = "openai" as const;
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly createClient: (apiKey: string) => OpenAiClientLike;

  constructor(options: OpenAiApiProviderOptions = {}) {
    this.readEnv = options.env ?? (() => process.env);
    this.createClient = options.createClient ?? ((apiKey) => new OpenAI({ apiKey }));
  }

  async answer(prompt: AnswerPrompt, options: AnswerOptions = {}): Promise<AnswerResult> {
    const env = this.readEnv();
    const apiKey = env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new MissingOpenAIKeyError();
    }

    const model = env.OPENAI_ASK_MODEL?.trim() || DEFAULT_OPENAI_ASK_MODEL;
    const detail = readScreenshotDetail(env.OPENAI_SCREENSHOT_DETAIL);
    const content: ResponseInputMessageContentList = [{ type: "input_text", text: prompt.userText }];

    for (const image of prompt.images) {
      content.push({
        type: "input_image",
        image_url: `data:${image.mimeType};base64,${image.base64}`,
        detail
      });
    }

    const response = await this.createClient(apiKey).responses.create(
      {
        model,
        store: false,
        max_output_tokens: readMaxOutputTokens(env.OPENAI_ASK_MAX_OUTPUT_TOKENS),
        input: [
          { role: "system", content: prompt.systemPrompt },
          { role: "user", content }
        ]
      },
      options.signal === undefined ? undefined : { signal: options.signal }
    );
    const text = response.output_text?.trim() ?? "";

    if (text.length === 0) {
      throw new AiProviderError(this.id, "OpenAI returned an empty answer.");
    }

    options.onText?.(text);

    return {
      text,
      model,
      ...(response.usage === undefined ? {} : { usage: response.usage })
    };
  }
}

function readScreenshotDetail(value: string | undefined): "auto" | "low" | "high" {
  return value === "low" || value === "high" ? value : "auto";
}

function readMaxOutputTokens(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASK_MAX_OUTPUT_TOKENS;
}
