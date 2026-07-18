import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayReadinessResultSchema } from "@mauzai/shared";
import {
  clearBackendCapabilitiesCache,
  detectBackendCapabilities,
  getGatewayReadinessStatus
} from "../src/backend/capabilities";

const GATEWAY_CAPABILITIES = {
  object: "hermes.api_server.capabilities",
  features: {
    responses_api: true,
    run_submission: true,
    run_events_sse: true,
    run_approval_response: true,
    session_continuity_header: "X-Hermes-Session-Id",
    session_key_header: "X-Hermes-Session-Key"
  }
};

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

afterEach(() => {
  clearBackendCapabilitiesCache();
  vi.useRealTimers();
});

describe("detectBackendCapabilities", () => {
  it("parses gateway capabilities", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));
    const caps = await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(caps).toEqual({
      sessionIdHeader: "X-Hermes-Session-Id",
      sessionKeyHeader: "X-Hermes-Session-Key",
      supportsRuns: true
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8642/v1/capabilities", expect.anything());
  });

  it("returns null for plain OpenAI-compatible endpoints (404)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await detectBackendCapabilities("https://api.example.com/v1", fetchMock)).toBeNull();
  });

  it("returns null when the probe throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await detectBackendCapabilities("http://localhost:9/v1", fetchMock)).toBeNull();
  });

  it("caches successful probes per baseUrl but re-probes on null", async () => {
    // Successful probe is cached — fetch called once across two calls
    const okMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));
    await detectBackendCapabilities("http://localhost:8642/v1", okMock);
    await detectBackendCapabilities("http://localhost:8642/v1", okMock);
    expect(okMock).toHaveBeenCalledTimes(1);

    clearBackendCapabilitiesCache();

    // Null result is NOT cached — fetch called twice (re-probed on each call)
    const nullMock = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    expect(await detectBackendCapabilities("http://localhost:8642/v1", nullMock)).toBeNull();
    expect(await detectBackendCapabilities("http://localhost:8642/v1", nullMock)).toBeNull();
    expect(nullMock).toHaveBeenCalledTimes(2);
  });

  it("re-probes after the 60s TTL expires", async () => {
    vi.useFakeTimers();
    const start = Date.now();

    const fetchMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));

    await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Still within TTL — should use cache
    vi.setSystemTime(start + 59_999);
    await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Just past TTL — should re-probe
    vi.setSystemTime(start + 60_001);
    await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not treat missing run features as runs support", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        features: {
          session_continuity_header: "X-Custom-Session-Id",
          session_key_header: "X-Custom-Session-Key"
        }
      })
    );
    const caps = await detectBackendCapabilities("http://localhost:8642/v1", fetchMock);
    expect(caps).toEqual({
      sessionIdHeader: "X-Custom-Session-Id",
      sessionKeyHeader: "X-Custom-Session-Key",
      supportsRuns: false
    });
  });
});

describe("getGatewayReadinessStatus", () => {
  it("returns simple when assistantMode is simple", async () => {
    const result = await getGatewayReadinessStatus("simple", "http://localhost:8642/v1");
    expect(result).toEqual({
      status: "simple",
      message: "Using the fast simple answer flow."
    });
    expect(() => GatewayReadinessResultSchema.parse(result)).not.toThrow();
  });

  it("returns ready when assistantMode is agentic and gateway supports full runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okJson(GATEWAY_CAPABILITIES));
    const result = await getGatewayReadinessStatus("agentic", "http://localhost:8642/v1", fetchMock);
    expect(result.status).toBe("ready");
    expect(result.message.length).toBeGreaterThan(0);
    expect(() => GatewayReadinessResultSchema.parse(result)).not.toThrow();
  });

  it("returns unavailable when the gateway is unreachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await getGatewayReadinessStatus("agentic", "http://localhost:9/v1", fetchMock);
    expect(result.status).toBe("unavailable");
    expect(result.message.length).toBeGreaterThan(0);
    expect(() => GatewayReadinessResultSchema.parse(result)).not.toThrow();
  });

  it("returns unsupported when the gateway does not support runs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okJson({
        features: {
          session_continuity_header: "X-Session-Id",
          session_key_header: "X-Session-Key"
        }
      })
    );
    const result = await getGatewayReadinessStatus("agentic", "http://localhost:8642/v1", fetchMock);
    expect(result.status).toBe("unsupported");
    expect(result.message.length).toBeGreaterThan(0);
    expect(() => GatewayReadinessResultSchema.parse(result)).not.toThrow();
  });

  it("returns unavailable when agentic but no base URL is configured", async () => {
    const result = await getGatewayReadinessStatus("agentic", "");
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/no gateway/i);
  });
});
