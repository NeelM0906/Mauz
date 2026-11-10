import type { AiProviderId, AiProviderStatus } from "@mauzai/shared";

export type AnswerImage = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  label: string;
};

export type AnswerPrompt = {
  systemPrompt: string;
  userText: string;
  images: AnswerImage[];
};

export type AnswerOptions = {
  onText?: ((textSoFar: string) => void) | undefined;
};

export type AnswerResult = {
  text: string;
};

export interface AnswerProvider {
  readonly id: AiProviderId;
  answer(prompt: AnswerPrompt, options?: AnswerOptions): Promise<AnswerResult>;
  /** Start any slow setup ahead of a likely answer request. Must be safe to call repeatedly. */
  prewarm?(systemPrompt: string): void;
  dispose?(): void;
}

export type ProviderDetection = Omit<AiProviderStatus, "id" | "label">;
