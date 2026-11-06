import {
  formatScreenBlock,
  getContextImage,
  type AskMauzRequest,
  type AskMauzResponse
} from "@mauzai/shared";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";
import { getDefaultAnswerProviderRegistry, type AnswerProviderRegistry } from "../providers/registry";
import type { AnswerImage, AnswerPrompt } from "../providers/types";

export type AskMauzOptions = {
  registry?: Pick<AnswerProviderRegistry, "resolve">;
  onText?: (textSoFar: string) => void;
  signal?: AbortSignal;
};

/** Answers with the provider the user configured or signed in to (API key or Claude Code / Codex subscription). */
export async function askMauz(
  request: AskMauzRequest,
  options: AskMauzOptions = {}
): Promise<AskMauzResponse> {
  const registry = options.registry ?? getDefaultAnswerProviderRegistry();
  const provider = await registry.resolve();
  const result = await provider.answer(buildAnswerPrompt(request), {
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
    systemPrompt: MAUZ_SYSTEM_PROMPT,
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

export function buildContextText(request: AskMauzRequest): string {
  const image = getContextImage(request.context);

  return [
    `<question>\n${request.question.trim()}\n</question>`,
    formatScreenBlock(request.context, image === undefined ? undefined : `attached: ${image.label}`)
  ].join("\n\n");
}
