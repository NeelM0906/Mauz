export class MissingOpenAIKeyError extends Error {
  constructor(message = "Set OPENAI_API_KEY before launching Mauz, then try again.") {
    super(message);
    this.name = "MissingOpenAIKeyError";
  }
}

export class OpenAIRealtimeConnectionError extends Error {
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly type: string | undefined;
  readonly param: string | undefined;

  constructor(
    message: string,
    options: {
      status?: number | undefined;
      code?: string | undefined;
      type?: string | undefined;
      param?: string | undefined;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "OpenAIRealtimeConnectionError";
    this.status = options.status;
    this.code = options.code;
    this.type = options.type;
    this.param = options.param;
  }
}
