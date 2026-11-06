export class MissingOpenAIKeyError extends Error {
  constructor(message = "Set OPENAI_API_KEY before launching Mauz, then try again.") {
    super(message);
    this.name = "MissingOpenAIKeyError";
  }
}

export class NoAiProviderError extends Error {
  constructor(
    message = "Mauz needs an AI provider. Sign in to Claude Code or Codex, or add an Anthropic or OpenAI API key in Settings."
  ) {
    super(message);
    this.name = "NoAiProviderError";
  }
}

/** A provider failed with a message that is safe to show the user. */
export class AiProviderError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AiProviderError";
    this.providerId = providerId;
  }
}
