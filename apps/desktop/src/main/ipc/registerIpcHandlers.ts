import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  AskMauzRequestSchema,
  ChatHistoryContinueRequestSchema,
  ChatHistoryGetRequestSchema,
  IPC_CHANNELS,
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
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.chatHistoryList,
  IPC_CHANNELS.chatHistoryGet,
  IPC_CHANNELS.chatHistoryContinue,
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

  ipcMain.handle(IPC_CHANNELS.menuShowMenu, () => {
    popover.resizeForMenu();
  });

  ipcMain.handle(IPC_CHANNELS.menuClose, () => {
    popover.hide();
  });

  ipcMain.handle(IPC_CHANNELS.menuStartAsk, async () => {
    const context = await contextCollector.collectForAsk();
    popover.resizeForAsk();
    return context;
  });
  ipcMain.handle(IPC_CHANNELS.menuStartTalk, async () => {
    const context = await contextCollector.collectForRealtime();
    popover.resizeForRealtime();
    return context;
  });

  ipcMain.handle(IPC_CHANNELS.settingsOpen, async (event) => {
    if (isPopoverEvent(event)) {
      popover.resizeForSettings();
    }

    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (_event, payload: unknown) => {
    const parsedPayload = MauzSettingsUpdateSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new Error("Invalid Mauz settings update.");
    }

    return updateSettings(toSettingsUpdate(parsedPayload.data));
  });

  ipcMain.handle(IPC_CHANNELS.askSubmit, async (_event, payload: unknown) => {
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
    if (isPopoverEvent(event)) {
      popover.resizeForHistory();
    }

    return chatHistory.list();
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryGet, async (_event, payload: unknown) => {
    const request = ChatHistoryGetRequestSchema.parse(payload);

    return chatHistory.get(request.id);
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryContinue, async (_event, payload: unknown) => {
    if (isPopoverEvent(_event)) {
      throw new Error("Continue chats from the Mauz desktop app.");
    }

    const request = ChatHistoryContinueRequestSchema.parse(payload);
    const conversation = await chatHistory.get(request.id);
    const context = await contextCollector.collectForAsk();
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

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, () => {
    throw new Error("Mauz uses the Realtime WebRTC unified connection path.");
  });

  ipcMain.handle(IPC_CHANNELS.realtimeConnect, async (_event, payload: unknown) => {
    return connectRealtimeToLocalApi(api, localApiToken, payload);
  });
}

function isPopoverEvent(event: IpcMainInvokeEvent | undefined): boolean {
  if (event === undefined) {
    return true;
  }

  const frameUrl = event.senderFrame?.url ?? event.sender.getURL();

  try {
    return new URL(frameUrl).searchParams.get("surface") !== "desktop";
  } catch {
    return true;
  }
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
