import { describe, expect, it } from "vitest";
import { buildFallbackChatTitle, normalizeChatTitle } from "../src/openai/generateChatTitle";

describe("chat title generation helpers", () => {
  it("normalizes model titles to short plain text", () => {
    expect(normalizeChatTitle('"Explain this confusing TypeScript error, please!"')).toBe(
      "Explain this confusing TypeScript error please"
    );
  });

  it("falls back to a short question title", () => {
    expect(buildFallbackChatTitle("What should I do here with this settings panel?")).toBe(
      "What should I do here with this"
    );
  });
});
