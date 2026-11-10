import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { AiProviderError, MissingOpenAIKeyError, NoAiProviderError } from "../src/errors";
import { answerAsk } from "../src/server";

vi.mock("../src/openai/askMauz", () => ({
  askMauz: vi.fn()
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

describe("answerAsk", () => {
  it("answers with the General AI provider", async () => {
    const result = await answerAsk(buildRequest());

    expect(result.answer).toBe("via-askMauz");
    expect(askMauz).toHaveBeenCalledWith(buildRequest(), {});
  });

  it("passes answer text so far to onText", async () => {
    const onText = vi.fn();
    vi.mocked(askMauz).mockImplementation(async (_request, options) => {
      options?.onText?.("partial");
      return { answer: "done", model: "gpt-mock" };
    });

    await answerAsk(buildRequest(), onText);

    expect(onText).toHaveBeenCalledWith("partial");
  });

  it.each([
    new NoAiProviderError(),
    new MissingOpenAIKeyError(),
    new AiProviderError("claude-code", "Claude Code is not signed in.")
  ])("keeps the message of $name", async (error) => {
    vi.mocked(askMauz).mockRejectedValue(error);

    await expect(answerAsk(buildRequest())).rejects.toBe(error);
  });

  it("hides the message of any other error", async () => {
    vi.mocked(askMauz).mockRejectedValue(new Error("socket hang up: sk-secret"));

    await expect(answerAsk(buildRequest())).rejects.toThrow(
      new Error("Ask Mauz failed while contacting the model.")
    );
  });
});
