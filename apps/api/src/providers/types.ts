import type { AiProviderId, AiProviderStatus } from "@mauzai/shared";

export type AskImage = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  label: string;
};

export type AskExchange = {
  userText: string;
  answer: string;
  phase?: "final_answer";
};

export type AskPrompt = {
  systemPrompt: string;
  userText: string;
  images: AskImage[];
  history?: AskExchange[];
};

export type AskOptions = {
  signal?: AbortSignal | undefined;
  onText?: ((textSoFar: string) => void) | undefined;
};

export type AskResult = {
  text: string;
  phase?: "final_answer";
};

export interface AskProvider {
  readonly id: AiProviderId;
  answer(prompt: AskPrompt, options?: AskOptions): Promise<AskResult>;
  /** Start any slow setup ahead of a likely answer request. Must be safe to call repeatedly. */
  prewarm?(systemPrompt: string): void;
  dispose?(): void;
}

export type ProviderDetection = Omit<AiProviderStatus, "id" | "label">;

/** One-shot CLI adapters can carry history as data without resuming a stored CLI session. */
export function askCliUserText(prompt: AskPrompt): string {
  if (!prompt.history?.length) return prompt.userText;
  const history = prompt.history.flatMap(({ userText, answer }) => [
    { role: "user", content: userText },
    { role: "assistant", content: answer }
  ]);
  return [
    "Earlier conversation (JSON):",
    JSON.stringify(history),
    "Latest user message:",
    prompt.userText
  ].join("\n\n");
}
