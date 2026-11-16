import OpenAI from "openai";
import type { ResponseInput, ResponseInputMessageContentList } from "openai/resources/responses/responses";
import { AiProviderError, MissingOpenAIKeyError } from "../errors";
import type { AskOptions, AskPrompt, AskProvider, AskResult } from "./types";

export const DEFAULT_OPENAI_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_ASK_MAX_OUTPUT_TOKENS = 700;

type OpenAiClientLike = Pick<OpenAI, "responses">;

type OpenAiApiProviderOptions = {
  env?: () => NodeJS.ProcessEnv;
  createClient?: (apiKey: string) => OpenAiClientLike;
};

/** Answers with the user's own OpenAI API key through the Responses API. */
export class OpenAiApiProvider implements AskProvider {
  readonly id = "openai" as const;
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly createClient: (apiKey: string) => OpenAiClientLike;

  constructor(options: OpenAiApiProviderOptions = {}) {
    this.readEnv = options.env ?? (() => process.env);
    this.createClient = options.createClient ?? ((apiKey) => new OpenAI({ apiKey }));
  }

  async answer(prompt: AskPrompt, options: AskOptions = {}): Promise<AskResult> {
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

    const history: ResponseInput = (prompt.history ?? []).flatMap(({ userText, answer, phase }) => [
      { role: "user", content: userText },
      { role: "assistant", content: answer, ...(phase === undefined ? {} : { phase }) }
    ]);
    const request = {
      model,
      store: false,
      max_output_tokens: readMaxOutputTokens(env.OPENAI_ASK_MAX_OUTPUT_TOKENS),
      input: [
        { role: "system", content: prompt.systemPrompt },
        ...history,
        { role: "user", content }
      ] satisfies ResponseInput
    };
    const client = this.createClient(apiKey);
    const response =
      options.signal === undefined
        ? await client.responses.create(request)
        : await client.responses.create(request, { signal: options.signal });
    const finalText = response.output
      ?.flatMap((item) =>
        item.type === "message" && item.phase === "final_answer"
          ? item.content.flatMap((part) => (part.type === "output_text" ? [part.text] : []))
          : []
      )
      .join("");
    const text = (finalText || response.output_text || "").trim();
    if (response.status !== undefined && response.status !== "completed") {
      throw new AiProviderError(this.id, "OpenAI did not finish the answer. Try again.");
    }

    if (text.length === 0) {
      throw new AiProviderError(this.id, "OpenAI returned an empty answer.");
    }

    options.onText?.(text);

    return { text, ...(finalText ? { phase: "final_answer" as const } : {}) };
  }
}

function readScreenshotDetail(value: string | undefined): "auto" | "low" | "high" {
  return value === "low" || value === "high" ? value : "auto";
}

function readMaxOutputTokens(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ASK_MAX_OUTPUT_TOKENS;
}
