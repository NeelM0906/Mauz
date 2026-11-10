import Anthropic from "@anthropic-ai/sdk";
import { AiProviderError, NoAiProviderError } from "../errors";
import type { AnswerOptions, AnswerPrompt, AnswerProvider, AnswerResult } from "./types";

export const DEFAULT_ANTHROPIC_ASK_MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = 16_000;

type AnthropicClientLike = Pick<Anthropic, "beta">;

export type AnthropicApiProviderOptions = {
  env?: () => NodeJS.ProcessEnv;
  createClient?: (apiKey: string) => AnthropicClientLike;
};

/** Answers with the user's own Anthropic API key, streaming text as it arrives. */
export class AnthropicApiProvider implements AnswerProvider {
  readonly id = "anthropic" as const;
  private readonly readEnv: () => NodeJS.ProcessEnv;
  private readonly createClient: (apiKey: string) => AnthropicClientLike;

  constructor(options: AnthropicApiProviderOptions = {}) {
    this.readEnv = options.env ?? (() => process.env);
    this.createClient = options.createClient ?? ((apiKey) => new Anthropic({ apiKey }));
  }

  async answer(prompt: AnswerPrompt, options: AnswerOptions = {}): Promise<AnswerResult> {
    const env = this.readEnv();
    const apiKey = env.ANTHROPIC_API_KEY?.trim();

    if (!apiKey) {
      throw new NoAiProviderError("Add an Anthropic API key in Settings, or pick another AI provider.");
    }

    const model = env.ANTHROPIC_ASK_MODEL?.trim() || DEFAULT_ANTHROPIC_ASK_MODEL;
    const client = this.createClient(apiKey);
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];

    for (const image of prompt.images) {
      content.push({ type: "text", text: image.label });
      content.push({
        type: "image",
        source: { type: "base64", media_type: image.mimeType, data: image.base64 }
      });
    }

    content.push({ type: "text", text: prompt.userText });

    try {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: MAX_OUTPUT_TOKENS,
          // Quick desktop answers: low effort keeps latency down; thinking stays adaptive.
          output_config: { effort: "low" },
          // If a safety classifier declines, the API retries on a fallback model in the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: prompt.systemPrompt,
          messages: [{ role: "user", content }]
        },
        options.signal === undefined ? undefined : { signal: options.signal }
      );
      let streamedText = "";

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          streamedText += event.delta.text;
          options.onText?.(streamedText);
        }
      }

      const message = await stream.finalMessage();

      if (message.stop_reason === "refusal") {
        throw new AiProviderError(this.id, "Claude declined to answer this request.");
      }

      const text = message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();

      if (text.length === 0) {
        throw new AiProviderError(this.id, "Claude returned an empty answer.");
      }

      return { text, model: message.model, usage: message.usage };
    } catch (error) {
      throw toAnthropicError(this.id, error);
    }
  }
}

// Checked before the generic APIError, which all of these extend.
const ANTHROPIC_ERROR_MESSAGES: ReadonlyArray<[abstract new (...args: never[]) => Error, string]> = [
  [Anthropic.AuthenticationError, "Anthropic rejected the API key. Check it in Settings."],
  [Anthropic.PermissionDeniedError, "This Anthropic API key cannot use the selected model."],
  [Anthropic.RateLimitError, "Anthropic rate limit reached. Try again shortly."],
  [Anthropic.APIConnectionError, "Mauz could not reach the Anthropic API. Check your connection."]
];

function toAnthropicError(providerId: string, error: unknown): Error {
  if (error instanceof AiProviderError || error instanceof NoAiProviderError) {
    return error;
  }

  const known = ANTHROPIC_ERROR_MESSAGES.find(([type]) => error instanceof type);

  if (known !== undefined) {
    return new AiProviderError(providerId, known[1], { cause: error });
  }

  if (error instanceof Anthropic.APIError) {
    return new AiProviderError(providerId, `Anthropic API error (${error.status ?? "unknown"}).`, {
      cause: error
    });
  }

  return error instanceof Error ? error : new Error(String(error));
}
