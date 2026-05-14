export class MissingOpenAIKeyError extends Error {
  constructor() {
    super("Add OPENAI_API_KEY to your .env file, then restart Mauz.");
    this.name = "MissingOpenAIKeyError";
  }
}
