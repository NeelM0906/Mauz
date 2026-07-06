import { describe, expect, it, vi } from "vitest";
import { getRunStatus, resolveRunApproval, startRun, stopRun, streamRunEvents } from "../src/backend/runsClient";

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("runsClient", () => {
  it("starts a run with session id, key and auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_abc", status: "started" }), { status: 202 })
    );
    const result = await startRun({
      baseUrl: "http://localhost:8642/v1",
      apiKey: "gw",
      input: [{ role: "user", content: "hi" }],
      instructions: "system prompt",
      sessionId: "conv-1",
      sessionKey: "install-1",
      fetchImpl: fetchMock
    });
    expect(result.runId).toBe("run_abc");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:8642/v1/runs");
    expect(init.headers).toMatchObject({
      authorization: "Bearer gw",
      "X-Hermes-Session-Key": "install-1"
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      input: [{ role: "user", content: "hi" }],
      instructions: "system prompt",
      session_id: "conv-1"
    });
  });

  it("uses custom sessionKeyHeader when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_abc" }), { status: 202 })
    );
    await startRun({
      baseUrl: "http://localhost:8642/v1",
      apiKey: "gw",
      input: "hi",
      sessionKey: "install-1",
      sessionKeyHeader: "X-Custom-Session-Key",
      fetchImpl: fetchMock
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers).toMatchObject({ "X-Custom-Session-Key": "install-1" });
    expect(init.headers["X-Hermes-Session-Key"]).toBeUndefined();
  });

  it("parses SSE events and ignores keepalive comments", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        ": keepalive\n\n",
        'data: {"event":"tool.started","run_id":"r","tool":"terminal"}\n\n',
        'data: {"event":"run.completed","run_id":"r","output":"done",',
        '"usage":{"total_tokens":5}}\n\n'
      ])
    );
    const events = [];
    for await (const event of streamRunEvents({ baseUrl: "http://x/v1", runId: "r", fetchImpl: fetchMock })) {
      events.push(event);
    }
    expect(events.map((event) => event.event)).toEqual(["tool.started", "run.completed"]);
    expect(events[1]?.output).toBe("done");
  });

  it("joins multiple data: lines with newline per SSE spec", async () => {
    // JSON split across two data: lines; joining with "" would produce invalid JSON
    // (the continuation has no comma prefix), but joining with "\n" is the spec-correct
    // behaviour and parseable for JSON that allows whitespace between tokens.
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"event":"run.completed","run_id":"r",\ndata: "output":"done"}\n\n'
      ])
    );
    const events = [];
    for await (const event of streamRunEvents({ baseUrl: "http://x/v1", runId: "r", fetchImpl: fetchMock })) {
      events.push(event);
    }
    expect(events[0]?.event).toBe("run.completed");
    expect(events[0]?.output).toBe("done");
  });

  it("falls back to SSE event: field when JSON lacks an event key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      sseResponse([
        'event: run.completed\ndata: {"run_id":"r","output":"done"}\n\n'
      ])
    );
    const events = [];
    for await (const event of streamRunEvents({ baseUrl: "http://x/v1", runId: "r", fetchImpl: fetchMock })) {
      events.push(event);
    }
    expect(events[0]?.event).toBe("run.completed");
    expect(events[0]?.output).toBe("done");
  });

  it("ends the stream on idle timeout without throwing", async () => {
    const fetchMock = vi.fn().mockImplementation(() => {
      // Stream that never sends data — simulates a stalled connection
      const stream = new ReadableStream<Uint8Array>({
        start() {
          // intentionally never enqueue or close
        }
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    const events: unknown[] = [];
    // Use a very short idle timeout so the test completes quickly
    await (async () => {
      for await (const event of streamRunEvents({
        baseUrl: "http://x/v1",
        runId: "r",
        fetchImpl: fetchMock,
        timeouts: { streamIdleMs: 50 }
      })) {
        events.push(event);
      }
    })();

    // Generator ended normally (no throw), zero events received
    expect(events).toHaveLength(0);
  });

  it("posts approval choices", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await resolveRunApproval({ baseUrl: "http://x/v1", runId: "r", choice: "session", fetchImpl: fetchMock });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://x/v1/runs/r/approval");
    expect(JSON.parse(init.body as string)).toEqual({ choice: "session" });
  });

  it("returns run status and null for unknown runs", async () => {
    const okMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "completed", output: "done" }), { status: 200 })
    );
    expect(await getRunStatus({ baseUrl: "http://x/v1", runId: "r", fetchImpl: okMock })).toMatchObject({
      status: "completed",
      output: "done"
    });

    const missingMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await getRunStatus({ baseUrl: "http://x/v1", runId: "r", fetchImpl: missingMock })).toBeNull();
  });

  it("cancels the reader when the consumer breaks early", async () => {
    let cancelSpy: ReturnType<typeof vi.fn> | undefined;
    const fetchMock = vi.fn().mockImplementation(() => {
      cancelSpy = vi.fn().mockResolvedValue(undefined);
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"event":"tool.started","run_id":"r"}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"event":"run.completed","run_id":"r","output":"x"}\n\n'));
          controller.close();
        },
        cancel: cancelSpy as unknown as (reason?: unknown) => void
      });
      return Promise.resolve(new Response(stream, { status: 200 }));
    });

    // Consumer breaks after the first event — simulates the runs-based ask
    // path exiting the loop on run.completed before the stream is drained.
    let count = 0;
    for await (const _ of streamRunEvents({ baseUrl: "http://x/v1", runId: "r", fetchImpl: fetchMock })) {
      count++;
      break;
    }
    expect(count).toBe(1);
    // reader.cancel() tears down the undici socket and signals the server
    expect(cancelSpy).toHaveBeenCalled();
  });

  it("stops runs and throws on failed start", async () => {
    const stopMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    await stopRun({ baseUrl: "http://x/v1", runId: "r", fetchImpl: stopMock });
    expect(stopMock.mock.calls[0]![0]).toBe("http://x/v1/runs/r/stop");

    const failMock = vi.fn().mockResolvedValue(new Response("busy", { status: 429 }));
    await expect(
      startRun({ baseUrl: "http://x/v1", input: "hi", fetchImpl: failMock })
    ).rejects.toThrow(/429/);
  });
});
