import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ChatHistoryService, formatHistoryDate } from "../src/main/chat/ChatHistoryService";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("ChatHistoryService", () => {
  it("persists text-only Ask conversations grouped by MM/DD/YY", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mauz-history-"));
    tempDirs.push(dir);
    const service = new ChatHistoryService(join(dir, "history.json"));

    const saved = await service.saveAskConversation({
      title: "Explain Settings Panel",
      question: "What is this?",
      answer: "This is a settings panel. It lets you tune the shake gesture."
    });
    const list = await service.list();
    const conversation = await service.get(saved.id);

    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]).toMatchObject({
      dateLabel: formatHistoryDate(saved.createdAt),
      conversations: [
        {
          id: saved.id,
          title: "Explain Settings Panel",
          preview: "This is a settings panel. It lets you tune the shake gesture."
        }
      ]
    });
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });

  it("updates a generated title after the conversation is already saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mauz-history-"));
    tempDirs.push(dir);
    const service = new ChatHistoryService(join(dir, "history.json"));
    const saved = await service.saveAskConversation({
      title: "What is this",
      question: "What is this?",
      answer: "This is a build error."
    });

    await expect(service.updateTitle(saved.id, "Build Error Diagnosis")).resolves.toMatchObject({
      id: saved.id,
      title: "Build Error Diagnosis"
    });
    await expect(service.get(saved.id)).resolves.toMatchObject({
      title: "Build Error Diagnosis"
    });
  });
});
