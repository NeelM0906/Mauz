import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { createDefaultAskHandler } from "../src/routes/ask";
import { createMauzApiServer } from "../src/server";

vi.mock("../src/openai/askMauz", () => ({
  askMauz: vi.fn().mockResolvedValue({ answer: "via-askMauz", model: "gpt-mock" })
}));

import { askMauz } from "../src/openai/askMauz";

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
});

describe("createDefaultAskHandler", () => {
  it("answers with the General AI provider", async () => {
    const result = await createDefaultAskHandler()(buildRequest());

    expect(result.answer).toBe("via-askMauz");
    expect(askMauz).toHaveBeenCalledTimes(1);
  });

  it("streams answer text for requests with a requestId", async () => {
    const onAnswerText = vi.fn();
    vi.mocked(askMauz).mockImplementation(async (_request, options) => {
      options?.onText?.("partial");
      return { answer: "done", model: "gpt-mock" };
    });

    await createDefaultAskHandler({ onAnswerText })({ ...buildRequest(), requestId: "req-1" });

    expect(onAnswerText).toHaveBeenCalledWith({ requestId: "req-1", text: "partial" });
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
