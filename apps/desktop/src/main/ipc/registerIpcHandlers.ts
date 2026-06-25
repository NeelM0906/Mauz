import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  AskMauzRequestSchema,
  ChatHistoryContinueRequestSchema,
  ChatHistoryDeleteRequestSchema,
  ChatHistoryGetRequestSchema,
  IPC_CHANNELS,
  MauzLensResizeRequestSchema,
  MauzSettingsUpdateSchema,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";
import type { ChatHistoryService } from "../chat/ChatHistoryService";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import { submitAskToLocalApi } from "./askApiClient";
import { generateChatTitleFromLocalApi } from "./chatTitleApiClient";
import { connectRealtimeToLocalApi } from "./realtimeApiClient";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
  chatHistory: ChatHistoryService;
  api: LocalApiHandle;
  localApiToken: string;
  getSettings: () => Promise<MauzSettings>;
  updateSettings: (update: MauzSettingsUpdate) => Promise<MauzSettings>;
};

const HANDLED_IPC_CHANNELS = [
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
  IPC_CHANNELS.realtimeConnect
] as const;

export function registerIpcHandlers({
  popover,
  contextCollector,
  chatHistory,
  api,
  localApiToken,
  getSettings,
  updateSettings
}: RegisterIpcHandlersOptions): void {
  for (const channel of HANDLED_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_CHANNELS.menuShowMenu, (event) => {
    assertTrustedSurface(event, ["popover"]);
    popover.resizeForMenu();
  });

  ipcMain.handle(IPC_CHANNELS.menuClose, (event) => {
    assertTrustedSurface(event, ["popover"]);
    contextCollector.discardActivationSnapshot();
    popover.hide();
  });

  ipcMain.handle(IPC_CHANNELS.menuStartAsk, async (event) => {
    assertTrustedSurface(event, ["popover"]);
    return contextCollector.collectForAsk();
  });
  ipcMain.handle(IPC_CHANNELS.menuStartTalk, async (event) => {
    assertTrustedSurface(event, ["popover"]);
    const context = await contextCollector.collectForRealtime();
    popover.resizeForRealtime();
    return context;
  });

  ipcMain.handle(IPC_CHANNELS.menuSetLensExpanded, (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const request = MauzLensResizeRequestSchema.parse(payload);

    if (request.expanded) {
      popover.resizeForAsk();
      return;
    }

    popover.resizeForMenu();
  });

  ipcMain.handle(IPC_CHANNELS.settingsOpen, async (event, payload: unknown) => {
    const surface = getTrustedSurface(event);

    if (surface === "popover" && shouldResizeForSettingsOpen(payload)) {
      popover.resizeForSettings();
    }

    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (event, payload: unknown) => {
    getTrustedSurface(event);
    const parsedPayload = MauzSettingsUpdateSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new Error("Invalid Mauz settings update.");
    }

    return updateSettings(toSettingsUpdate(parsedPayload.data));
  });

  ipcMain.handle(IPC_CHANNELS.askSubmit, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const request = AskMauzRequestSchema.parse(payload);
    const response = await submitAskToLocalApi(api, localApiToken, request);
    const fallbackTitle = buildFallbackChatTitle(request.question);

    try {
      const conversation = await chatHistory.saveAskConversation({
        question: request.question,
        answer: response.answer,
        title: fallbackTitle
      });

      queueGeneratedTitleUpdate(api, localApiToken, chatHistory, conversation.id, {
        question: request.question,
        answer: response.answer
      });

      return {
        ...response,
        conversationId: conversation.id,
        conversationTitle: fallbackTitle
      };
    } catch {
      return response;
    }
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryList, async (event) => {
    const surface = getTrustedSurface(event);

    if (surface === "popover") {
      popover.resizeForHistory();
    }

    return chatHistory.list();
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryGet, async (event, payload: unknown) => {
    getTrustedSurface(event);
    const request = ChatHistoryGetRequestSchema.parse(payload);

    return chatHistory.get(request.id);
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryContinue, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["desktop"]);
    const request = ChatHistoryContinueRequestSchema.parse(payload);
    const conversation = await chatHistory.get(request.id);
    const context = await contextCollector.collectForAsk({
      useActivationSnapshot: false
    });
    const response = await submitAskToLocalApi(api, localApiToken, {
      question: request.question,
      context,
      conversationMessages: conversation.messages
    });
    const updatedConversation = await chatHistory.appendAskTurn(request.id, {
      question: request.question,
      answer: response.answer
    });

    return {
      conversation: updatedConversation,
      answer: response.answer,
      model: response.model
    };
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryDelete, async (event, payload: unknown) => {
    getTrustedSurface(event);
    const request = ChatHistoryDeleteRequestSchema.parse(payload);

    await chatHistory.delete(request.id);
    return chatHistory.list();
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryClear, async (event) => {
    getTrustedSurface(event);

    await chatHistory.clear();
    return chatHistory.list();
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, (event) => {
    getTrustedSurface(event);
    throw new Error("Mauz uses the Realtime WebRTC unified connection path.");
  });

  ipcMain.handle(IPC_CHANNELS.realtimeConnect, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    return connectRealtimeToLocalApi(api, localApiToken, payload);
  });
}

type RendererSurface = "desktop" | "popover";

function assertTrustedSurface(event: IpcMainInvokeEvent, allowed: readonly RendererSurface[]): void {
  const surface = getTrustedSurface(event);

  if (!allowed.includes(surface)) {
    throw new Error("Mauz rejected an IPC request from the wrong renderer surface.");
  }
}

function getTrustedSurface(event: IpcMainInvokeEvent | undefined): RendererSurface {
  if (event === undefined) {
    throw new Error("Mauz rejected an IPC request without renderer metadata.");
  }

  const frameUrl = event.senderFrame?.url ?? event.sender.getURL();

  try {
    const url = new URL(frameUrl);

    if (!isTrustedRendererOrigin(url)) {
      throw new Error("untrusted origin");
    }

    const surface = url.searchParams.get("surface");

    if (surface === "desktop" || surface === "popover") {
      return surface;
    }
  } catch {
    // Fall through to the generic rejection below.
  }

  throw new Error("Mauz rejected an IPC request from an untrusted renderer.");
}

function isTrustedRendererOrigin(url: URL): boolean {
  if (url.protocol === "file:") {
    return true;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}

function shouldResizeForSettingsOpen(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || !("resizePopover" in payload)) {
    return true;
  }

  return payload.resizePopover !== false;
}

function queueGeneratedTitleUpdate(
  api: LocalApiHandle,
  localApiToken: string,
  chatHistory: ChatHistoryService,
  conversationId: string,
  payload: { question: string; answer: string }
): void {
  void generateChatTitleFromLocalApi(api, localApiToken, payload)
    .then(async (response) => {
      await chatHistory.updateTitle(conversationId, response.title);
    })
    .catch(() => {
      // Title generation is deliberately off the answer path.
    });
}

function buildFallbackChatTitle(question: string): string {
  const words = question
    .replace(/["'`]/g, "")
    .replace(/[.,:;!?()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 7);

  return words.length > 0 ? words.join(" ") : "Untitled Mauz Chat";
}

function toSettingsUpdate(parsedUpdate: {
  nativeShakeEnabled?: boolean | undefined;
  devHotkeyEnabled?: boolean | undefined;
  shakeSensitivity?: MauzSettings["shakeSensitivity"] | undefined;
  openAiAuthMode?: MauzSettings["openAiAuthMode"] | undefined;
  openAiAuthDisconnected?: MauzSettings["openAiAuthDisconnected"] | undefined;
  askModel?: string | undefined;
  chatTitleModel?: string | undefined;
  realtimeModel?: string | undefined;
  realtimeVoice?: string | undefined;
  realtimeReasoningEffort?: MauzSettings["realtimeReasoningEffort"] | undefined;
  includeFullScreenshot?: boolean | undefined;
  openAiApiKey?: string | null | undefined;
  clearOpenAiApiKey?: boolean | undefined;
}): MauzSettingsUpdate {
  const update: MauzSettingsUpdate = {};

  if (parsedUpdate.nativeShakeEnabled !== undefined) {
    update.nativeShakeEnabled = parsedUpdate.nativeShakeEnabled;
  }

  if (parsedUpdate.devHotkeyEnabled !== undefined) {
    update.devHotkeyEnabled = parsedUpdate.devHotkeyEnabled;
  }

  if (parsedUpdate.shakeSensitivity !== undefined) {
    update.shakeSensitivity = parsedUpdate.shakeSensitivity;
  }

  if (parsedUpdate.openAiAuthMode !== undefined) {
    update.openAiAuthMode = parsedUpdate.openAiAuthMode;
  }

  if (parsedUpdate.openAiAuthDisconnected !== undefined) {
    update.openAiAuthDisconnected = parsedUpdate.openAiAuthDisconnected;
  }

  if (parsedUpdate.askModel !== undefined) {
    update.askModel = parsedUpdate.askModel;
  }

  if (parsedUpdate.chatTitleModel !== undefined) {
    update.chatTitleModel = parsedUpdate.chatTitleModel;
  }

  if (parsedUpdate.realtimeModel !== undefined) {
    update.realtimeModel = parsedUpdate.realtimeModel;
  }

  if (parsedUpdate.realtimeVoice !== undefined) {
    update.realtimeVoice = parsedUpdate.realtimeVoice;
  }

  if (parsedUpdate.realtimeReasoningEffort !== undefined) {
    update.realtimeReasoningEffort = parsedUpdate.realtimeReasoningEffort;
  }

  if (parsedUpdate.includeFullScreenshot !== undefined) {
    update.includeFullScreenshot = parsedUpdate.includeFullScreenshot;
  }

  if (parsedUpdate.openAiApiKey !== undefined) {
    update.openAiApiKey = parsedUpdate.openAiApiKey;
  }

  if (parsedUpdate.clearOpenAiApiKey !== undefined) {
    update.clearOpenAiApiKey = parsedUpdate.clearOpenAiApiKey;
  }

  return update;
}
