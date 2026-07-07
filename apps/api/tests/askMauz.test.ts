import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { askMauz, buildContextText, buildResponseContent } from "../src/openai/askMauz";
import { MAUZ_SYSTEM_PROMPT } from "../src/prompts/mauzSystemPrompt";
import { clearBackendCapabilitiesCache } from "../src/backend/capabilities";
import { BackendUnreachableError, MissingOpenAIKeyError } from "../src/errors";

function buildRequest(): AskMauzRequest {
  return {
    question: "What is this?",
    context: {
      timestamp: new Date("2026-05-13T20:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: { x: 100, y: 200 }
    }
  };
}

const requestWithPointerContext: AskMauzRequest = {
  question: "What is this?",
  context: {
    timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 640,
      y: 360
    },
    pointer: {
      cursor: {
        x: 640,
        y: 360
      },
      cursorCrop: {
        mimeType: "image/jpeg",
        base64: "cursor-crop-base64",
        width: 768,
        height: 576
      },
      screenshot: {
        mimeType: "image/jpeg",
        base64: "full-screenshot-base64",
        width: 1280,
        height: 720
      }
    }
  }
};

describe("Ask Mauz prompt payload", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends only the cursor crop by default for faster pointer asks", () => {
    const content = buildResponseContent(requestWithPointerContext);

    expect(content).toHaveLength(2);
    expect(content[0]).toMatchObject({
      type: "input_text"
    });
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,cursor-crop-base64",
      detail: "auto"
    });
  });

  it("can send the cursor crop before the full screenshot when broad context is enabled", () => {
    vi.stubEnv("OPENAI_INCLUDE_FULL_SCREENSHOT", "true");

    const content = buildResponseContent(requestWithPointerContext);

    expect(content).toHaveLength(3);
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,cursor-crop-base64",
      detail: "auto"
    });
    expect(content[2]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,full-screenshot-base64",
      detail: "auto"
    });
  });

  it("describes pointer priority for vague this-or-that questions", () => {
    const contextText = buildContextText(requestWithPointerContext);

    expect(contextText).toContain(
      "Reference resolution priority: selected text > cursor-centered crop > active window metadata > full screenshot > cursor position."
    );
    expect(contextText).toContain("cursor-centered crop image/jpeg, 768x576");
    expect(MAUZ_SYSTEM_PROMPT).toContain(
      "resolve the reference in this order: selected text, cursor-centered crop, active window metadata, full screenshot, cursor position"
    );
    expect(MAUZ_SYSTEM_PROMPT).toContain(
      "You are MauzAI, a focused desktop assistant created by FirstPoint Labs."
    );
  });

  it("puts selected text ahead of cursor crop in the text context", () => {
    const contextText = buildContextText({
      ...requestWithPointerContext,
      context: {
        ...requestWithPointerContext.context,
        selectedText: "TypeError: Cannot read properties of undefined"
      }
    });

    expect(contextText).toContain(
      "Reference resolution priority: selected text > cursor-centered crop > active window metadata > full screenshot > cursor position."
    );
    expect(contextText).toContain("Selected text: TypeError: Cannot read properties of undefined");
    expect(contextText.indexOf("Selected text:")).toBeLessThan(contextText.indexOf("Pointer context:"));
  });

  it("includes previous messages when continuing a saved chat", () => {
    const contextText = buildContextText({
      ...requestWithPointerContext,
      question: "What should I do next?",
      conversationMessages: [
        {
          id: "message-1",
          role: "user",
          content: "What is this warning?",
          createdAt: "2026-05-14T12:00:00.000Z"
        },
        {
          id: "message-2",
          role: "assistant",
          content: "It is a permissions warning.",
          createdAt: "2026-05-14T12:00:01.000Z"
        }
      ]
    });

    expect(contextText).toContain("Previous conversation:");
    expect(contextText).toContain("User: What is this warning?");
    expect(contextText).toContain("Mauz: It is a permissions warning.");
  });
});

describe("askMauz with configurable backend", () => {
  beforeEach(() => {
    vi.stubEnv("MAUZ_BACKEND_API_KEY", "");
    vi.stubEnv("MAUZ_BACKEND_BASE_URL", "");
    vi.stubEnv("MAUZ_INSTALL_ID", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    clearBackendCapabilitiesCache();
    vi.unstubAllEnvs();
  });

  it("sends session headers when a gateway backend is detected", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: "ok", usage: undefined });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: {
            session_continuity_header: "X-Hermes-Session-Id",
            session_key_header: "X-Hermes-Session-Key",
            run_submission: true,
            run_events_sse: true,
            run_approval_response: true
          }
        }),
        { status: 200 }
      )
    );
    const response = await askMauz(
      { ...buildRequest(), sessionId: "conv-1" },
      {
        client: { responses: { create } } as never,
        baseUrl: "http://localhost:8642/v1",
        backendApiKey: "gw-key",
        installId: "install-uuid",
        fetchImpl: fetchMock
      }
    );
    expect(response.answer).toBe("ok");
    const requestOptions = create.mock.calls[0]?.[1];
    expect(requestOptions?.headers).toMatchObject({
      "X-Hermes-Session-Id": "conv-1",
      "X-Hermes-Session-Key": "install-uuid"
    });
  });

  it("omits the session key header without a backend api key", async () => {
    const create = vi.fn().mockResolvedValue({ output_text: "ok" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          features: {
            session_continuity_header: "X-Hermes-Session-Id",
            session_key_header: "X-Hermes-Session-Key"
          }
        }),
        { status: 200 }
      )
    );
    await askMauz(
      { ...buildRequest(), sessionId: "conv-1" },
      {
        client: { responses: { create } } as never,
        baseUrl: "http://localhost:8642/v1",
        installId: "install-uuid",
        fetchImpl: fetchMock
      }
    );
    const requestOptions = create.mock.calls[0]?.[1];
    expect(requestOptions?.headers).not.toHaveProperty("X-Hermes-Session-Key");
  });

  it("does not require an OpenAI key when a custom backend is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    // OPENAI_API_KEY is already cleared by beforeEach; no client or apiKey provided
    const error = await askMauz(buildRequest(), {
      baseUrl: "http://127.0.0.1:9/v1",
      fetchImpl: fetchMock
    }).catch((e: unknown) => e);
    // Must have passed the MissingOpenAIKeyError guard and attempted the backend call
    expect(error).toBeInstanceOf(BackendUnreachableError);
    expect(error).not.toBeInstanceOf(MissingOpenAIKeyError);
  });

  it("raises BackendUnreachableError when the backend connection fails", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("fetch failed"), { name: "APIConnectionError" }));
    const fetchMock = vi.fn().mockResolvedValue(new Response("no", { status: 404 }));
    await expect(
      askMauz(buildRequest(), {
        client: { responses: { create } } as never,
        baseUrl: "http://localhost:8642/v1",
        fetchImpl: fetchMock
      })
    ).rejects.toThrow(/localhost:8642 is not responding/);
  });
});
