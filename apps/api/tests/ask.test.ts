import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { clearBackendCapabilitiesCache } from "../src/backend/capabilities";
import { createDefaultAskHandler } from "../src/routes/ask";
import { createMauzApiServer } from "../src/server";

vi.mock("../src/backend/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/backend/capabilities")>();
  return {
    ...actual,
    detectBackendCapabilities: vi.fn()
  };
});

vi.mock("../src/backend/askViaRuns", () => ({
  askViaRuns: vi.fn().mockResolvedValue({ answer: "via-runs", model: "hermes-agent" })
}));

vi.mock("../src/openai/askMauz", () => ({
  askMauz: vi.fn().mockResolvedValue({ answer: "via-askMauz", model: "gpt-mock" })
}));

import { detectBackendCapabilities } from "../src/backend/capabilities";
import { askViaRuns } from "../src/backend/askViaRuns";
import { askMauz } from "../src/openai/askMauz";

const CAPS_NO_RUNS = {
  sessionIdHeader: "X-Session-Id",
  sessionKeyHeader: "X-Session-Key",
  supportsRuns: false
};

const CAPS_WITH_RUNS = {
  sessionIdHeader: "X-Session-Id",
  sessionKeyHeader: "X-Session-Key",
  supportsRuns: true
};

function buildRequest(): AskMauzRequest {
  return {
    question: "test?",
    context: {
      timestamp: new Date("2026-07-04T00:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: { x: 0, y: 0 }
    }
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(askMauz).mockResolvedValue({ answer: "via-askMauz", model: "gpt-mock" });
  vi.mocked(askViaRuns).mockResolvedValue({ answer: "via-runs", model: "hermes-agent" });
  clearBackendCapabilitiesCache();
  delete process.env.MAUZ_BACKEND_BASE_URL;
  delete process.env.MAUZ_BACKEND_API_KEY;
  delete process.env.OPENAI_ASK_MODEL;
  delete process.env.MAUZ_AGENT_MODE;
  delete process.env.MAUZ_INSTALL_ID;
  delete process.env.MAUZ_BACKEND_PRESET;
});

afterEach(() => {
  clearBackendCapabilitiesCache();
  delete process.env.MAUZ_BACKEND_BASE_URL;
  delete process.env.MAUZ_BACKEND_PRESET;
});

describe("createDefaultAskHandler dispatch", () => {
  it("(a) routes to askMauz when MAUZ_BACKEND_BASE_URL is not set", async () => {
    const handler = createDefaultAskHandler(undefined);
    const result = await handler(buildRequest());
    expect(askMauz).toHaveBeenCalledTimes(1);
    expect(askViaRuns).not.toHaveBeenCalled();
    expect(detectBackendCapabilities).not.toHaveBeenCalled();
    expect(result.answer).toBe("via-askMauz");
  });

  it("(b) routes to askMauz when capabilities do not include runs support", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_NO_RUNS);

    const handler = createDefaultAskHandler(undefined);
    const result = await handler(buildRequest());
    expect(detectBackendCapabilities).toHaveBeenCalledWith("http://localhost:8642/v1");
    expect(askViaRuns).not.toHaveBeenCalled();
    expect(askMauz).toHaveBeenCalledTimes(1);
    expect(result.answer).toBe("via-askMauz");
  });

  it("(c) routes to askViaRuns when capabilities include runs support", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_WITH_RUNS);

    const handler = createDefaultAskHandler(undefined);
    const result = await handler(buildRequest());
    expect(detectBackendCapabilities).toHaveBeenCalledWith("http://localhost:8642/v1");
    expect(askViaRuns).toHaveBeenCalledTimes(1);
    expect(askMauz).not.toHaveBeenCalled();
    expect(result.answer).toBe("via-runs");
  });

  it("(d) passes sessionKeyHeader from capabilities to askViaRuns", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    vi.mocked(detectBackendCapabilities).mockResolvedValue({
      sessionIdHeader: "X-Hermes-Session-Id",
      sessionKeyHeader: "X-Hermes-Session-Key",
      supportsRuns: true
    });

    const handler = createDefaultAskHandler(undefined);
    await handler(buildRequest());
    expect(askViaRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionKeyHeader: "X-Hermes-Session-Key" })
    );
  });
});

describe("resolveModelLabel", () => {
  it("uses OPENAI_ASK_MODEL when set", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    process.env.OPENAI_ASK_MODEL = "custom-model";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_WITH_RUNS);

    const handler = createDefaultAskHandler(undefined);
    await handler(buildRequest());
    expect(askViaRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "custom-model" })
    );
  });

  it("derives model from MAUZ_BACKEND_PRESET (e.g. hermes → hermes-agent)", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    process.env.MAUZ_BACKEND_PRESET = "hermes";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_WITH_RUNS);

    const handler = createDefaultAskHandler(undefined);
    await handler(buildRequest());
    expect(askViaRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "hermes-agent" })
    );
  });

  it("falls back to hermes-agent when MAUZ_BACKEND_PRESET is openai", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    process.env.MAUZ_BACKEND_PRESET = "openai";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_WITH_RUNS);

    const handler = createDefaultAskHandler(undefined);
    await handler(buildRequest());
    expect(askViaRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "hermes-agent" })
    );
  });

  it("falls back to hermes-agent when no OPENAI_ASK_MODEL and no MAUZ_BACKEND_PRESET", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    vi.mocked(detectBackendCapabilities).mockResolvedValue(CAPS_WITH_RUNS);

    const handler = createDefaultAskHandler(undefined);
    await handler(buildRequest());
    expect(askViaRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "hermes-agent" })
    );
  });
});

describe("body limit", () => {
  it("accepts payloads larger than 1 MiB without returning 413", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      askHandler: async () => ({ answer: "ok", model: "test" })
    });

    // Build a payload that exceeds the default 1 MiB Fastify limit
    const largeBase64 = Buffer.alloc(1.5 * 1024 * 1024, "a").toString("base64");
    const payload = {
      question: "hi",
      context: {
        timestamp: new Date().toISOString(),
        platform: "darwin",
        cursor: { x: 0, y: 0 },
        screenshot: { mimeType: "image/jpeg", base64: largeBase64, width: 100, height: 100 }
      }
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload
    });

    expect(response.statusCode).not.toBe(413);
    expect(response.statusCode).toBe(200);
  });
});
