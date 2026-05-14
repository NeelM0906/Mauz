import { ipcMain } from "electron";
import {
  AskMauzRequestSchema,
  ChatHistoryGetRequestSchema,
  IPC_CHANNELS,
  MauzSettingsUpdateSchema,
  RealtimeSessionResponseSchema,
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
  IPC_CHANNELS.menuStartScreenShare,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.chatHistoryList,
  IPC_CHANNELS.chatHistoryGet,
  IPC_CHANNELS.realtimeCreateSession,
  IPC_CHANNELS.realtimeConnect,
  IPC_CHANNELS.realtimeCaptureFrame
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
  ipcMain.handle(IPC_CHANNELS.menuStartScreenShare, async () => {
    const context = await contextCollector.collectForRealtime();
    popover.resizeForRealtime();
    return context;
  });

  ipcMain.handle(IPC_CHANNELS.settingsOpen, async () => {
    popover.resizeForSettings();
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
    const title = await generateTitleSafely(api, localApiToken, {
      question: request.question,
      answer: response.answer
    });

    try {
      const conversation = await chatHistory.saveAskConversation({
        question: request.question,
        answer: response.answer,
        title
      });

      return {
        ...response,
        conversationId: conversation.id,
        conversationTitle: conversation.title
      };
    } catch {
      return response;
    }
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryList, async () => {
    popover.resizeForHistory();
    return chatHistory.list();
  });

  ipcMain.handle(IPC_CHANNELS.chatHistoryGet, async (_event, payload: unknown) => {
    const request = ChatHistoryGetRequestSchema.parse(payload);

    return chatHistory.get(request.id);
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, () => {
    const unavailable = RealtimeSessionResponseSchema.safeParse({ value: "" });

    if (!unavailable.success) {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
  });

  ipcMain.handle(IPC_CHANNELS.realtimeConnect, async (_event, payload: unknown) => {
    return connectRealtimeToLocalApi(api, localApiToken, payload);
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCaptureFrame, () => contextCollector.collectRealtimeFrame());
}

async function generateTitleSafely(
  api: LocalApiHandle,
  localApiToken: string,
  payload: { question: string; answer: string }
): Promise<string> {
  try {
    const response = await generateChatTitleFromLocalApi(api, localApiToken, payload);

    return response.title;
  } catch {
    return buildFallbackChatTitle(payload.question);
  }
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

  return update;
}
