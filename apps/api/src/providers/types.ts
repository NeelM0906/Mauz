import type { AiProviderId, AiProviderStatus } from "@mauzai/shared";

export type AskImage = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  label: string;
};

export type AskPrompt = {
  systemPrompt: string;
  userText: string;
  images: AskImage[];
};

export type AskOptions = {
  onText?: ((textSoFar: string) => void) | undefined;
};

export type AskResult = {
  text: string;
};

export interface AskProvider {
  readonly id: AiProviderId;
  answer(prompt: AskPrompt, options?: AskOptions): Promise<AskResult>;
  /** Start any slow setup ahead of a likely answer request. Must be safe to call repeatedly. */
  prewarm?(systemPrompt: string): void;
  dispose?(): void;
}

export type ProviderDetection = Omit<AiProviderStatus, "id" | "label">;
