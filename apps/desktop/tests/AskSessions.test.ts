import { describe, expect, it, vi } from "vitest";
import type { AskMauzRequest, AskSessionView } from "@mauzai/shared";
import type { AskOptions, AskPrompt, AskProvider } from "@mauzai/api/server";
import { AskSessions } from "../src/main/ask/AskSessions";

const page = { identity: "profile:tab:document", executable: "Chrome", blocked: false };
const source: AskMauzRequest["context"] = {
  platform: "darwin",
  timestamp: "2026-11-15T15:00:00.000Z",
  cursor: { x: 0, y: 0 },
  selectedText: "The Munich Agreement was signed in 1938.",
  screenshot: { base64: "aW1hZ2U=", mimeType: "image/jpeg", width: 32, height: 32 }
};

function setup() {
  let now = 0;
  const onChange = vi.fn<(session: AskSessionView | null) => void>();
  const answer = vi.fn(async (_provider: AskProvider, _prompt: AskPrompt, options: AskOptions) => {
    options.onText?.("Munich");
    return { text: "The Munich Agreement was signed in 1938.", phase: "final_answer" as const };
  });
  const resolveProvider = vi.fn(async () => ({ id: "openai" as const, answer: vi.fn() }));
  const sessions = new AskSessions({ onChange, answer, resolveProvider, now: () => now });
  return {
    sessions,
    answer,
    resolveProvider,
    onChange,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describe("Ask sessions", () => {
  it("continues with ordered dialogue and doesn't repeat a screenshot on text follow-ups", async () => {
    const { sessions, answer, resolveProvider } = setup();
    const chat = sessions.open(page, source);
    await sessions.submit(
      {
        sessionId: chat.id,
        requestId: "1",
        question: "What happened in Munich in 1938?",
        sourceId: chat.source!.id,
        includeScreenshot: true
      },
      vi.fn()
    );
    sessions.suspend();
    const resumed = sessions.open(page, { ...source, cursor: { x: 10, y: 0 } });
    expect(resumed.id).toBe(chat.id);
    expect(resumed.source).toBeNull();
    await sessions.submit(
      { sessionId: chat.id, requestId: "2", question: "How is this event related to X?" },
      vi.fn()
    );

    expect(answer.mock.calls[0]?.[1].images).toHaveLength(1);
    expect(answer.mock.calls[1]?.[1]).toMatchObject({
      userText: "How is this event related to X?",
      history: [
        expect.objectContaining({
          userText: expect.stringContaining("What happened in Munich"),
          phase: "final_answer"
        })
      ],
      images: []
    });
    expect(resolveProvider.mock.calls).toEqual([[undefined], ["openai"]]);
    sessions.close();
  });

  it("stages new text and labels two explicitly attached screenshots by when they were captured", async () => {
    const { sessions, answer } = setup();
    const chat = sessions.open(page, source);
    await sessions.submit(
      {
        sessionId: chat.id,
        requestId: "1",
        question: "Explain this first chart.",
        sourceId: chat.source!.id,
        includeScreenshot: true
      },
      vi.fn()
    );
    sessions.suspend();
    const updated = sessions.open(page, {
      ...source,
      selectedText: "A second graph",
      screenshot: { ...source.screenshot!, base64: "bmV3" }
    });
    expect(updated.source).toMatchObject({ label: "Selected text", useImage: false, hasImage: true });
    await sessions.submit(
      {
        sessionId: updated.id,
        requestId: "2",
        question: "Compare the charts.",
        sourceId: updated.source!.id,
        includeScreenshot: true,
        earlierImageId: updated.turns[0]!.imageId
      },
      vi.fn()
    );
    expect(answer.mock.calls[1]?.[1].images.map(({ label, base64 }) => ({ label, base64 }))).toEqual([
      { label: expect.stringContaining("Earlier"), base64: "aW1hZ2U=" },
      { label: expect.stringContaining("Current"), base64: "bmV3" }
    ]);
    sessions.close();
  });

  it("keeps screen text without claiming an attachment when the user turns off the screenshot", async () => {
    const { sessions, answer } = setup();
    const chat = sessions.open(page, source);
    await sessions.submit(
      {
        sessionId: chat.id,
        requestId: "1",
        question: "What does this say?",
        sourceId: chat.source!.id,
        includeScreenshot: false
      },
      vi.fn()
    );

    const prompt = answer.mock.calls[0]![1];
    expect(prompt.images).toEqual([]);
    expect(prompt.userText).toContain(source.selectedText);
    expect(prompt.userText).not.toContain("<image>");
    sessions.close();
  });

  it("resumes only on a verified document before the five-minute boundary", () => {
    const { sessions, advance } = setup();
    const chat = sessions.open(page);
    sessions.suspend();
    advance(299_999);
    expect(sessions.matches({ ...page, identity: "another-tab" })).toBe(false);
    expect(sessions.matches({ blocked: false })).toBe(false);
    expect(sessions.matches({ ...page, blocked: true })).toBe(false);
    expect(sessions.matches(page)).toBe(true);
    advance(1);
    expect(sessions.matches(page)).toBe(false);
    expect(sessions.open(page).id).not.toBe(chat.id);
    sessions.close();
  });

  it("discards pending output on New chat and rejects cross-session attachments", async () => {
    const { sessions, answer } = setup();
    const chat = sessions.open(page, source);
    let complete!: (value: { text: string; phase: "final_answer" }) => void;
    answer.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const pending = sessions.submit({ sessionId: chat.id, requestId: "1", question: "First" }, vi.fn());
    await Promise.resolve();
    const next = sessions.newChat(chat.id);
    expect(answer.mock.calls[0]?.[2].signal?.aborted).toBe(true);
    complete({ text: "late answer", phase: "final_answer" });
    await pending;
    await expect(
      sessions.submit({ sessionId: chat.id, requestId: "2", question: "Old" }, vi.fn())
    ).rejects.toThrow("no longer open");
    await expect(
      sessions.submit(
        { sessionId: next.id, requestId: "3", question: "New", earlierImageId: chat.source!.id },
        vi.fn()
      )
    ).rejects.toThrow("no longer available");
    expect(sessions.current()?.turns).toEqual([]);
    sessions.close();
  });

  it("does not commit a failed or repeated turn and retries from the same complete history", async () => {
    const { sessions, answer } = setup();
    const chat = sessions.open(page, source);
    const first = {
      sessionId: chat.id,
      requestId: "1",
      question: "First",
      sourceId: chat.source!.id,
      includeScreenshot: true
    };
    answer.mockRejectedValueOnce(new Error("Offline"));
    await sessions.submit(first, vi.fn());
    await sessions.submit(first, vi.fn());
    expect(sessions.current()?.turns).toEqual([]);
    expect(sessions.current()?.failure).toMatchObject({ message: "Offline", sourceId: first.sourceId });
    await sessions.submit({ ...first, requestId: "2" }, vi.fn());
    expect(answer).toHaveBeenCalledTimes(2);
    expect(answer.mock.calls[1]?.[1].history).toEqual([]);
    expect(sessions.current()?.turns).toHaveLength(1);
    sessions.close();
  });
});
