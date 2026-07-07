export class MissingOpenAIKeyError extends Error {
  constructor(message = "Set OPENAI_API_KEY before launching Mauz, then try again.") {
    super(message);
    this.name = "MissingOpenAIKeyError";
  }
}

export class BackendUnreachableError extends Error {
  constructor(baseUrl: string, options: { cause?: unknown } = {}) {
    super(
      `Mauz backend at ${formatBackendHost(baseUrl)} is not responding. Check that it is running, then try again.`,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "BackendUnreachableError";
  }
}

function formatBackendHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

export class AgentRunStoppedError extends Error {
  constructor() {
    super("The agent run was stopped.");
    this.name = "AgentRunStoppedError";
  }
}

export class AgentRunUnwatchableError extends Error {
  constructor() {
    super(
      "Mauz lost the live connection to the agent, but it is still working. Its results will land in the agent's session and memory."
    );
    this.name = "AgentRunUnwatchableError";
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
