import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}));
const realtimeApiClientMock = vi.hoisted(() => ({
  connectRealtimeToLocalApi: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: ipcMainMock
}));
vi.mock("../src/main/ipc/realtimeApiClient", () => realtimeApiClientMock);

import { IPC_CHANNELS, type MauzDesktopContext, type RealtimeConnectRequest } from "@mauzai/shared";
import type { AgentRunBridge } from "../src/main/agent/AgentRunBridge";
import type { ContextCollector } from "../src/main/context/ContextCollector";
import { registerIpcHandlers } from "../src/main/ipc/registerIpcHandlers";
import type { LocalApiHandle } from "../src/main/server/launchLocalApi";
import type { PopoverWindowController } from "../src/main/windows/PopoverWindowController";

const HANDLED_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuStartTalk,
  IPC_CHANNELS.menuSetLensExpanded,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.chatHistoryList,
  IPC_CHANNELS.chatHistoryGet,
  IPC_CHANNELS.chatHistoryContinue,
  IPC_CHANNELS.chatHistoryDelete,
  IPC_CHANNELS.chatHistoryClear,
  IPC_CHANNELS.realtimeCreateSession,
  IPC_CHANNELS.realtimeConnect,
  IPC_CHANNELS.agentApprovalRespond,
  IPC_CHANNELS.agentStop
] as const;

describe("registerIpcHandlers", () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    realtimeApiClientMock.connectRealtimeToLocalApi.mockReset();
    vi.unstubAllGlobals();
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

    await expect(handler(createInvokeEvent("popover"))).resolves.toEqual(context);
    expect(options.popover.resizeForAsk).not.toHaveBeenCalled();
    expect(options.popover.resizeForMenu).not.toHaveBeenCalled();
  });

  it("resizes Lens only when the popover asks to expand or collapse", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuSetLensExpanded);

    await handler(createInvokeEvent("popover"), {
      expanded: true
    });
    expect(options.popover.resizeForAsk).toHaveBeenCalledOnce();
    expect(options.popover.resizeForMenu).not.toHaveBeenCalled();

    await handler(createInvokeEvent("popover"), {
      expanded: false
    });
    expect(options.popover.resizeForMenu).toHaveBeenCalledOnce();
  });

  it("clears activation context when the popover closes", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuClose);

    await handler(createInvokeEvent("popover"));

    expect(options.contextCollector.discardActivationSnapshot).toHaveBeenCalledOnce();
    expect(options.popover.hide).toHaveBeenCalledOnce();
  });

  it("opens Talk mode with Realtime context", async () => {
    const options = createOptions();
    const context = createRealtimeContext();

    vi.mocked(options.contextCollector.collectForRealtime).mockResolvedValue(context);
    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartTalk);

    await expect(handler(createInvokeEvent("popover"))).resolves.toEqual(context);
    expect(options.contextCollector.collectForRealtime).toHaveBeenCalledOnce();
    expect(options.popover.resizeForRealtime).toHaveBeenCalledOnce();
  });

  it("connects Realtime through the local API", async () => {
    const options = createOptions();
    const request: RealtimeConnectRequest = {
      offerSdp: "v=0\r\nt=- 0 0\r\n",
      mode: "talk",
      context: createRealtimeContext()
    };

    realtimeApiClientMock.connectRealtimeToLocalApi.mockResolvedValue({
      answerSdp: "answer-sdp",
      model: "test-realtime-model"
    });
    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.realtimeConnect);

    await expect(handler(createInvokeEvent("popover"), request)).resolves.toEqual({
      answerSdp: "answer-sdp",
      model: "test-realtime-model"
    });
    expect(realtimeApiClientMock.connectRealtimeToLocalApi).toHaveBeenCalledWith(
      options.api,
      "test-token",
      request
    );
  });

  it("does not resize the popover when desktop opens settings", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await handler(createInvokeEvent("desktop"));

    expect(options.popover.resizeForSettings).not.toHaveBeenCalled();
  });

  it("can read settings from the popover without opening the settings panel", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await handler(createInvokeEvent("popover"), {
      resizePopover: false
    });

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
    ).rejects.toThrow("Mauz rejected an IPC request from the wrong renderer surface.");
    expect(options.chatHistory.get).not.toHaveBeenCalled();
  });

  it("deletes a saved conversation from a trusted renderer", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryDelete);

    await expect(handler(createInvokeEvent("desktop"), { id: "conversation-id" })).resolves.toEqual({
      groups: []
    });
    expect(options.chatHistory.delete).toHaveBeenCalledWith("conversation-id");
    expect(options.chatHistory.list).toHaveBeenCalledOnce();
  });

  it("clears saved conversations from a trusted renderer", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryClear);

    await expect(handler(createInvokeEvent("desktop"))).resolves.toEqual({
      groups: []
    });
    expect(options.chatHistory.clear).toHaveBeenCalledOnce();
    expect(options.chatHistory.list).toHaveBeenCalledOnce();
  });

  it("rejects privileged invoke calls without renderer metadata", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartAsk);

    await expect(handler()).rejects.toThrow("Mauz rejected an IPC request without renderer metadata.");
    expect(options.contextCollector.collectForAsk).not.toHaveBeenCalled();
  });

  it("accepts trusted loopback dev renderer origins", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryList);

    await expect(handler(createInvokeEvent("popover", "http://[::1]:5173"))).resolves.toEqual({
      groups: []
    });
    expect(options.popover.resizeForHistory).toHaveBeenCalledOnce();
  });

  it("rejects renderer requests from non-local origins", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryList);

    await expect(handler(createInvokeEvent("popover", "https://example.test"))).rejects.toThrow(
      "Mauz rejected an IPC request from an untrusted renderer."
    );
    expect(options.chatHistory.list).not.toHaveBeenCalled();
  });

  it("passes assistantMode and agentMode through to updateSettings without stripping them", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsUpdate);

    await handler(createInvokeEvent("popover"), {
      assistantMode: "agentic",
      agentMode: "yolo"
    });

    expect(options.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ assistantMode: "agentic", agentMode: "yolo" })
    );
  });

  it("forwards the conversation id as sessionId when continuing a chat", async () => {
    let capturedAskBody: Record<string, unknown> = {};

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedAskBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        json: async () => ({ answer: "mocked answer", model: "test-model" })
      };
    });

    const options = createOptions();
    const conversation: import("@mauzai/shared").ChatConversation = {
      id: "conv-42",
      title: "Test conversation",
      createdAt: "2026-05-14T12:00:00.000Z",
      updatedAt: "2026-05-14T12:00:00.000Z",
      messages: []
    };

    vi.mocked(options.chatHistory.get).mockResolvedValueOnce(conversation);
    vi.mocked(options.chatHistory.appendAskTurn).mockResolvedValueOnce(conversation);
    vi.mocked(options.contextCollector.collectForAsk).mockResolvedValueOnce({
      timestamp: "2026-05-14T12:00:00.000Z",
      platform: "darwin",
      cursor: { x: 0, y: 0 }
    });

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.chatHistoryContinue);

    await handler(createInvokeEvent("desktop"), {
      id: "conv-42",
      question: "What does this mean?"
    });

    expect(capturedAskBody.sessionId).toBe("conv-42");
  });
});

function getRegisteredHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainMock.handle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);

  if (call === undefined) {
    throw new Error(`Missing registered handler for ${channel}.`);
  }

  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

function createInvokeEvent(surface: "desktop" | "popover", origin = "file:///renderer"): unknown {
  const url = `${origin}/index.html?surface=${surface}`;

  return {
    senderFrame: {
      url
    },
    sender: {
      getURL: () => url
    }
  };
}

function createRealtimeContext(): MauzDesktopContext {
  return {
    timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 200,
      y: 300
    },
    pointer: {
      cursor: {
        x: 200,
        y: 300
      },
      cursorCrop: {
        mimeType: "image/jpeg",
        base64: "cursor-crop",
        width: 320,
        height: 240
      }
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
    discardActivationSnapshot: vi.fn()
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
      }),
      updateTitle: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      clear: vi.fn(async () => {})
    } as never,
    api,
    localApiToken: "test-token",
    agentRunBridge: {
      respondToApproval: vi.fn(),
      stopActiveRun: vi.fn(async () => {})
    } as unknown as AgentRunBridge,
    getSettings: vi.fn(async () => ({
      nativeShakeEnabled: false,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal" as const,
      openAiAuthMode: "api-key" as const,
      openAiAuthDisconnected: false,
      openAiCredentialSource: "none" as const,
      askModel: "gpt-5.4-mini",
      chatTitleModel: "gpt-5.4-nano",
      realtimeModel: "gpt-realtime-2",
      realtimeVoice: "marin",
      realtimeReasoningEffort: "low" as const,
      includeFullScreenshot: false,
      apiKeyConfigured: false,
      assistantMode: "simple" as const,
      backendBaseUrl: "",
      agentMode: "approve" as const
    })),
    updateSettings: vi.fn(async (update) => ({
      nativeShakeEnabled: update.nativeShakeEnabled ?? false,
      devHotkeyEnabled: update.devHotkeyEnabled ?? true,
      shakeSensitivity: update.shakeSensitivity ?? ("normal" as const),
      openAiAuthMode: update.openAiAuthMode ?? ("api-key" as const),
      openAiAuthDisconnected: update.openAiAuthDisconnected ?? false,
      openAiCredentialSource: "none" as const,
      askModel: update.askModel ?? "gpt-5.4-mini",
      chatTitleModel: update.chatTitleModel ?? "gpt-5.4-nano",
      realtimeModel: update.realtimeModel ?? "gpt-realtime-2",
      realtimeVoice: update.realtimeVoice ?? "marin",
      realtimeReasoningEffort: update.realtimeReasoningEffort ?? ("low" as const),
      includeFullScreenshot: update.includeFullScreenshot ?? false,
      apiKeyConfigured: false,
      assistantMode: update.assistantMode ?? ("simple" as const),
      backendBaseUrl: update.backendBaseUrl ?? "",
      agentMode: update.agentMode ?? ("approve" as const)
    }))
  };
}
