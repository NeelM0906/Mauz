export class MissingOpenAIKeyError extends Error {
  constructor(message = "Configure OpenAI access in Mauz settings, then try again.") {
    super(message);
    this.name = "MissingOpenAIKeyError";
  }
}
