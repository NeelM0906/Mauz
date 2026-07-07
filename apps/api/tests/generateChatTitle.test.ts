import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OpenAI from "openai";
import { buildFallbackChatTitle, generateChatTitle, normalizeChatTitle } from "../src/openai/generateChatTitle";
import { MissingOpenAIKeyError } from "../src/errors";

vi.mock("openai", () => {
  const mockCreate = vi.fn().mockResolvedValue({ output_text: "My Chat Title" });
  // Must use a regular function (not arrow) so `new MockOpenAI(...)` works
  function MockOpenAI(this: { responses: { create: typeof mockCreate } }, _opts?: unknown) {
    this.responses = { create: mockCreate };
  }
  const SpiedConstructor = vi.fn(MockOpenAI);
  return { default: SpiedConstructor };
});

beforeEach(() => {
  vi.mocked(OpenAI).mockClear();
  delete process.env.OPENAI_API_KEY;
  delete process.env.MAUZ_BACKEND_BASE_URL;
  delete process.env.MAUZ_BACKEND_API_KEY;
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.MAUZ_BACKEND_BASE_URL;
  delete process.env.MAUZ_BACKEND_API_KEY;
});

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

describe("generateChatTitle", () => {
  it("throws MissingOpenAIKeyError when no OPENAI_API_KEY and no MAUZ_BACKEND_BASE_URL", async () => {
    await expect(
      generateChatTitle({ question: "Q", answer: "A" })
    ).rejects.toBeInstanceOf(MissingOpenAIKeyError);
  });

  it("uses OPENAI_API_KEY when set and no backend URL", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const result = await generateChatTitle({ question: "Q", answer: "A" });
    expect(result.title).toBeDefined();
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk-test" })
    );
    // Should NOT have baseURL set to a backend
    const callArgs = vi.mocked(OpenAI).mock.calls[0]![0] as Record<string, unknown>;
    expect(callArgs.baseURL).toBeUndefined();
  });

  it("uses MAUZ_BACKEND_BASE_URL when set (no OPENAI_API_KEY required)", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    // No OPENAI_API_KEY — should not throw
    const result = await generateChatTitle({ question: "Q", answer: "A" });
    expect(result.title).toBeDefined();
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "http://localhost:8642/v1" })
    );
  });

  it("uses MAUZ_BACKEND_API_KEY as apiKey when backend URL is set", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    process.env.MAUZ_BACKEND_API_KEY = "backend-key-123";
    await generateChatTitle({ question: "Q", answer: "A" });
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "backend-key-123", baseURL: "http://localhost:8642/v1" })
    );
  });

  it("uses mauz-local-backend placeholder key when MAUZ_BACKEND_BASE_URL set and no API key", async () => {
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:8642/v1";
    await generateChatTitle({ question: "Q", answer: "A" });
    expect(vi.mocked(OpenAI)).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "mauz-local-backend" })
    );
  });

  it("prefers options.client over env-based construction", async () => {
    const mockClient = {
      responses: {
        create: vi.fn().mockResolvedValue({ output_text: "injected title" })
      }
    } as unknown as OpenAI;
    const result = await generateChatTitle({ question: "Q", answer: "A" }, { client: mockClient });
    expect(result.title).toBe("injected title");
    expect(vi.mocked(OpenAI)).not.toHaveBeenCalled();
  });
});
