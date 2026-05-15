import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: ipcMainMock
}));

import { IPC_CHANNELS, type MauzDesktopContext } from "@mauzai/shared";
import type { ContextCollector } from "../src/main/context/ContextCollector";
import { registerIpcHandlers } from "../src/main/ipc/registerIpcHandlers";
import type { LocalApiHandle } from "../src/main/server/launchLocalApi";
import type { PopoverWindowController } from "../src/main/windows/PopoverWindowController";

const HANDLED_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuStartTalk,
  IPC_CHANNELS.menuStartScreenShare,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.chatHistoryList,
  IPC_CHANNELS.chatHistoryGet,
  IPC_CHANNELS.chatHistoryContinue,
  IPC_CHANNELS.realtimeCreateSession,
  IPC_CHANNELS.realtimeConnect,
  IPC_CHANNELS.realtimeCaptureFrame
] as const;

describe("registerIpcHandlers", () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
  });

  it("removes owned invoke handlers before registering them", () => {
    registerIpcHandlers(createOptions());

    expect(ipcMainMock.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(HANDLED_CHANNELS);
    expect(ipcMainMock.handle.mock.calls.map(([channel]) => channel)).toEqual(HANDLED_CHANNELS);
    expect(Math.max(...ipcMainMock.removeHandler.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...ipcMainMock.handle.mock.invocationCallOrder)
    );
  });

  it("can register twice without reusing stale handlers", () => {
    registerIpcHandlers(createOptions());
    registerIpcHandlers(createOptions());

    expect(ipcMainMock.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      ...HANDLED_CHANNELS,
      ...HANDLED_CHANNELS
    ]);
    expect(ipcMainMock.handle.mock.calls.map(([channel]) => channel)).toEqual([
      ...HANDLED_CHANNELS,
      ...HANDLED_CHANNELS
    ]);
  });

  it("opens Ask mode even when screenshot capture returned a permission fallback", async () => {
    const options = createOptions();
    const context: MauzDesktopContext = {
      timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: {
        x: 200,
        y: 300
      },
      screenshotError: {
        permission: "screen-recording",
        message: "Mauz needs Screen Recording permission to capture screenshot context."
      }
    };

    vi.mocked(options.contextCollector.collectForAsk).mockResolvedValue(context);
    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartAsk);

    await expect(handler()).resolves.toEqual(context);
    expect(options.popover.resizeForAsk).toHaveBeenCalledOnce();
  });

  it("opens Realtime mode with captured pointer context", async () => {
    const options = createOptions();
    const context: MauzDesktopContext = {
      timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: {
        x: 200,
        y: 300
      }
    };

    vi.mocked(options.contextCollector.collectForRealtime).mockResolvedValue(context);
    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartTalk);

    await expect(handler()).resolves.toEqual(context);
    expect(options.popover.resizeForRealtime).toHaveBeenCalledOnce();
  });

  it("does not resize the popover when desktop opens settings", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await handler(createInvokeEvent("desktop"));

    expect(options.popover.resizeForSettings).not.toHaveBeenCalled();
  });

  it("blocks continuing chats from the popover surface", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryContinue);

    await expect(
      handler(createInvokeEvent("popover"), {
        id: "conversation-id",
        question: "Can you expand on this?"
      })
    ).rejects.toThrow("Continue chats from the Mauz desktop app.");
    expect(options.chatHistory.get).not.toHaveBeenCalled();
  });
});

function getRegisteredHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainMock.handle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);

  if (call === undefined) {
    throw new Error(`Missing registered handler for ${channel}.`);
  }

  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

function createInvokeEvent(surface: "desktop" | "popover"): unknown {
  const url = `file:///renderer/index.html?surface=${surface}`;

  return {
    senderFrame: {
      url
    },
    sender: {
      getURL: () => url
    }
  };
}

function createOptions(): Parameters<typeof registerIpcHandlers>[0] {
  const popover = {
    hide: vi.fn(),
    resizeForAsk: vi.fn(),
    resizeForMenu: vi.fn(),
    resizeForRealtime: vi.fn(),
    resizeForHistory: vi.fn(),
    resizeForSettings: vi.fn()
  } as unknown as PopoverWindowController;
  const contextCollector = {
    collectBasicContext: vi.fn(),
    collectForAsk: vi.fn(),
    collectForRealtime: vi.fn(),
    collectRealtimeFrame: vi.fn()
  } as unknown as ContextCollector;
  const api: LocalApiHandle = {
    baseUrl: "http://127.0.0.1:47891",
    port: 47891,
    stop: vi.fn(async () => {})
  };

  return {
    popover,
    contextCollector,
    chatHistory: {
      saveAskConversation: vi.fn(async ({ question, answer, title }) => ({
        id: "conversation-id",
        title,
        createdAt: "2026-05-14T12:00:00.000Z",
        updatedAt: "2026-05-14T12:00:00.000Z",
        messages: [
          {
            id: "question-id",
            role: "user" as const,
            content: question,
            createdAt: "2026-05-14T12:00:00.000Z"
          },
          {
            id: "answer-id",
            role: "assistant" as const,
            content: answer,
            createdAt: "2026-05-14T12:00:00.000Z"
          }
        ]
      })),
      list: vi.fn(async () => ({
        groups: []
      })),
      get: vi.fn(async () => {
        throw new Error("not found");
      }),
      appendAskTurn: vi.fn(async () => {
        throw new Error("not found");
      })
    } as never,
    api,
    localApiToken: "test-token",
    getSettings: vi.fn(async () => ({
      nativeShakeEnabled: false,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal" as const,
      openAiAuthMode: "api-key" as const,
      askModel: "gpt-5.4-mini",
      chatTitleModel: "gpt-5.4-nano",
      realtimeModel: "gpt-realtime-2",
      realtimeVoice: "marin",
      realtimeReasoningEffort: "low" as const,
      includeFullScreenshot: false,
      apiKeyConfigured: false
    })),
    updateSettings: vi.fn(async (update) => ({
      nativeShakeEnabled: update.nativeShakeEnabled ?? false,
      devHotkeyEnabled: update.devHotkeyEnabled ?? true,
      shakeSensitivity: update.shakeSensitivity ?? ("normal" as const),
      openAiAuthMode: update.openAiAuthMode ?? ("api-key" as const),
      askModel: update.askModel ?? "gpt-5.4-mini",
      chatTitleModel: update.chatTitleModel ?? "gpt-5.4-nano",
      realtimeModel: update.realtimeModel ?? "gpt-realtime-2",
      realtimeVoice: update.realtimeVoice ?? "marin",
      realtimeReasoningEffort: update.realtimeReasoningEffort ?? ("low" as const),
      includeFullScreenshot: update.includeFullScreenshot ?? false,
      apiKeyConfigured: (update.openAiApiKey?.trim().length ?? 0) > 0
    }))
  };
}
