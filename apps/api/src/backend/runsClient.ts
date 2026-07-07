export const REQUEST_TIMEOUT_MS = 15_000;
export const STREAM_IDLE_TIMEOUT_MS = 180_000;

export type RunEvent = { event: string; run_id?: string } & Record<string, unknown>;

export type RunsClientOptions = {
  baseUrl: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sessionKeyHeader?: string;
  timeouts?: {
    requestMs?: number;
    streamIdleMs?: number;
  };
};

export async function startRun(
  options: RunsClientOptions & {
    input: unknown;
    instructions?: string;
    sessionId?: string;
    sessionKey?: string;
  }
): Promise<{ runId: string }> {
  const requestTimeoutMs = options.timeouts?.requestMs ?? REQUEST_TIMEOUT_MS;
  const sessionKeyHeader = options.sessionKeyHeader ?? "X-Hermes-Session-Key";
  const response = await request(options, "POST", "/runs", {
    body: {
      input: options.input,
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
      ...(options.sessionId === undefined ? {} : { session_id: options.sessionId })
    },
    extraHeaders: options.sessionKey === undefined ? {} : { [sessionKeyHeader]: options.sessionKey },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  const body = (await response.json()) as { run_id?: string };

  if (typeof body.run_id !== "string" || body.run_id.length === 0) {
    throw new Error("Agent backend did not return a run id.");
  }

  return { runId: body.run_id };
}

export async function* streamRunEvents(
  options: RunsClientOptions & { runId: string }
): AsyncGenerator<RunEvent> {
  const streamIdleMs = options.timeouts?.streamIdleMs ?? STREAM_IDLE_TIMEOUT_MS;
  const response = await request(options, "GET", `/runs/${options.runId}/events`);

  if (response.body === null) {
    throw new Error("Agent backend returned no event stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let readResult: ReadableStreamReadResult<Uint8Array>;

      try {
        readResult = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => reject(new Error("stream-idle-timeout")), streamIdleMs);
          })
        ]);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err instanceof Error && err.message === "stream-idle-timeout") {
          await reader.cancel();
          return;
        }
        throw err;
      }

      clearTimeout(timeoutId);

      const { done, value } = readResult;

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");

      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const event = parseSseEvent(rawEvent);

        if (event !== null) {
          yield event;
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } finally {
    await reader.cancel();
  }
}

export async function resolveRunApproval(
  options: RunsClientOptions & { runId: string; choice: "once" | "session" | "always" | "deny" }
): Promise<void> {
  const requestTimeoutMs = options.timeouts?.requestMs ?? REQUEST_TIMEOUT_MS;
  await request(options, "POST", `/runs/${options.runId}/approval`, {
    body: { choice: options.choice },
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

export async function stopRun(options: RunsClientOptions & { runId: string }): Promise<void> {
  const requestTimeoutMs = options.timeouts?.requestMs ?? REQUEST_TIMEOUT_MS;
  await request(options, "POST", `/runs/${options.runId}/stop`, {
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

export type RunStatus = { status: string; output?: string; usage?: unknown; error?: string };

export async function getRunStatus(
  options: RunsClientOptions & { runId: string }
): Promise<RunStatus | null> {
  try {
    const requestTimeoutMs = options.timeouts?.requestMs ?? REQUEST_TIMEOUT_MS;
    const response = await request(options, "GET", `/runs/${options.runId}`, {
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
    const body = (await response.json()) as unknown;

    if (typeof body === "object" && body !== null && "status" in body) {
      return body as RunStatus;
    }

    return null;
  } catch {
    return null;
  }
}

async function request(
  options: RunsClientOptions,
  method: "GET" | "POST",
  path: string,
  init: { body?: unknown; extraHeaders?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(options.apiKey === undefined ? {} : { authorization: `Bearer ${options.apiKey}` }),
      ...(init.extraHeaders ?? {})
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    ...(init.signal === undefined ? {} : { signal: init.signal })
  });

  if (!response.ok && response.status !== 202) {
    throw new Error(`Agent backend request ${method} ${path} failed with status ${response.status}.`);
  }

  return response;
}

function parseSseEvent(rawEvent: string): RunEvent | null {
  const lines = rawEvent.split("\n");
  const dataLines = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim());

  if (dataLines.length === 0) {
    return null;
  }

  // Per SSE spec, multiple data: lines are joined with "\n"
  const joined = dataLines.join("\n");

  // Extract the SSE event: field for fallback when JSON lacks an "event" key
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const sseEventName = eventLine?.slice(6).trim();

  try {
    const parsed = JSON.parse(joined) as unknown;

    if (typeof parsed === "object" && parsed !== null) {
      if ("event" in parsed) {
        return parsed as RunEvent;
      }

      if (sseEventName !== undefined) {
        return { ...(parsed as Record<string, unknown>), event: sseEventName } as RunEvent;
      }
    }

    return null;
  } catch {
    return null;
  }
}
