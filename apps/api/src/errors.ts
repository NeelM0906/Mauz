export class MissingOpenAIKeyError extends Error {
  constructor(message = "Set OPENAI_API_KEY before launching Mauz, then try again.") {
    super(message);
    this.name = "MissingOpenAIKeyError";
  }
}
