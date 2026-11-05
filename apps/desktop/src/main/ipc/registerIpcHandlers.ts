import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  AiProvidersStatusRequestSchema,
  AiProvidersStatusResponseSchema,
  AskMauzRequestSchema,
  ChatHistoryContinueRequestSchema,
  ChatHistoryDeleteRequestSchema,
  ChatHistoryGetRequestSchema,
  IPC_CHANNELS,
  MauzLensResizeRequestSchema,
  MauzSettingsUpdateSchema,
  SubscriptionCancelRequestSchema,
  SubscriptionCodeRequestSchema,
  SubscriptionConnectRequestSchema,
  SubscriptionConnectStateSchema,
  SubscriptionDisconnectRequestSchema,
  TalkTranscribeRequestSchema,
  TalkTranscribeResponseSchema,
  TaskAgentsResponseSchema,
  TaskFoldersRequestSchema,
  TaskFoldersResponseSchema,
  TaskSendRequestSchema,
  TaskSendResponseSchema,
  type Bounds,
  type BrowserExtensionStatus,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";
import { getAiProvidersStatus, type SubscriptionConnector } from "@mauzai/api/server";
import type { TaskAgentLauncher } from "../agent/TaskAgentLauncher";
import type { ChatHistoryService } from "../chat/ChatHistoryService";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import type { TalkTranscriber } from "../talk/TalkTranscriber";
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
  taskAgents: {
    launcher: Pick<
      TaskAgentLauncher,
      | "listAgents"
      | "resolveAgent"
      | "listFolders"
      | "toTaskFolder"
      | "folderKey"
      | "defaultFolder"
      | "launch"
    >;
    /** Opens a folder dialog over the asking surface; null when cancelled. */
    pickFolder(surface: "popover" | "desktop"): Promise<string | null>;
  };
  getProvidersStatus?: typeof getAiProvidersStatus;
  talkTranscriber?: Pick<TalkTranscriber, "transcribe">;
  subscriptionConnector?: Pick<
    SubscriptionConnector,
    "connect" | "submitCode" | "cancel" | "disconnect" | "getState"
  >;
  openExternal?: (url: string) => Promise<void>;
  /**
   * Hides the popover, lets the user drag a rectangle (screen DIPs), runs `collect` on it while
   * the popover is still hidden, then shows the popover again. Null when the user cancels.
   */
  selectRegion?: <T>(collect: (region: Bounds) => Promise<T>) => Promise<T | null>;
  browserExtension?: {
    status(): BrowserExtensionStatus;
    openExtensionFolder(): Promise<void>;
  };
};

const HANDLED_IPC_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuStartTalk,
  IPC_CHANNELS.menuSelectRegion,
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
  IPC_CHANNELS.taskAgents,
  IPC_CHANNELS.taskFolders,
  IPC_CHANNELS.taskPickFolder,
  IPC_CHANNELS.taskSend,
  IPC_CHANNELS.providersStatus,
  IPC_CHANNELS.providersConnect,
  IPC_CHANNELS.providersConnectCode,
  IPC_CHANNELS.providersConnectCancel,
  IPC_CHANNELS.providersConnectOpenPage,
  IPC_CHANNELS.providersDisconnect,
  IPC_CHANNELS.talkTranscribe,
  IPC_CHANNELS.talkCaptureContext,
  IPC_CHANNELS.browserStatus,
  IPC_CHANNELS.browserOpenExtensionFolder
] as const;

export function registerIpcHandlers({
  popover,
  contextCollector,
  chatHistory,
  api,
  localApiToken,
  getSettings,
  updateSettings,
  taskAgents,
  getProvidersStatus = getAiProvidersStatus,
  talkTranscriber,
  subscriptionConnector,
  openExternal,
  selectRegion,
  browserExtension
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

  ipcMain.handle(IPC_CHANNELS.menuSelectRegion, async (event) => {
    assertTrustedSurface(event, ["popover"]);

    if (selectRegion === undefined) {
      throw new Error("Selecting an area is not available.");
    }

    contextCollector.discardActivationSnapshot();

    return selectRegion((region) => contextCollector.collectForRegion(region));
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

    return updateSettings(parsedPayload.data as MauzSettingsUpdate);
  });

  ipcMain.handle(IPC_CHANNELS.askSubmit, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const request = AskMauzRequestSchema.parse(payload);
    const response = await submitAskToLocalApi(api, localApiToken, request);

    // Spoken push-to-talk turns are part of a live voice session, not saved text chats.
    if (request.responseStyle === "voice") {
      return response;
    }

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
      conversationMessages: conversation.messages,
      sessionId: request.id
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

  ipcMain.handle(IPC_CHANNELS.taskAgents, async (event) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const settings = await getSettings();
    const agents = taskAgents.launcher.listAgents();

    return TaskAgentsResponseSchema.parse({
      agents,
      selectedAgentId: taskAgents.launcher.resolveAgent(settings.taskAgent, agents)
    });
  });

  ipcMain.handle(IPC_CHANNELS.taskFolders, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const { agentId } = TaskFoldersRequestSchema.parse(payload);
    const settings = await getSettings();
    const launcher = taskAgents.launcher;
    const defaultFolder = launcher.defaultFolder(settings.taskFolder);
    const lastUsed = settings.taskAgentFolders[agentId];
    // The last folder used with this agent first, then the agent's own recent folders, then the default.
    const candidates = [
      ...(lastUsed === undefined ? [] : [launcher.toTaskFolder(lastUsed)]),
      ...launcher.listFolders(agentId),
      launcher.toTaskFolder(defaultFolder)
    ];
    const seen = new Set<string>();
    const folders = candidates.filter((folder) => {
      const key = launcher.folderKey(folder.path);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    return TaskFoldersResponseSchema.parse({
      folders: folders.slice(0, 100),
      selectedPath: lastUsed ?? defaultFolder
    });
  });

  ipcMain.handle(IPC_CHANNELS.taskPickFolder, async (event) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    return taskAgents.pickFolder(getTrustedSurface(event));
  });

  ipcMain.handle(IPC_CHANNELS.taskSend, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const request = TaskSendRequestSchema.parse(payload);
    const result = await taskAgents.launcher.launch(request);
    const settings = await getSettings();

    await updateSettings({
      taskAgentFolders: { ...settings.taskAgentFolders, [request.agentId]: request.folder }
    });

    return TaskSendResponseSchema.parse(result);
  });

  ipcMain.handle(IPC_CHANNELS.providersStatus, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const request = AiProvidersStatusRequestSchema.parse(payload);
    const status = await getProvidersStatus({ refresh: request?.refresh === true });

    return AiProvidersStatusResponseSchema.parse(status);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnect, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const request = SubscriptionConnectRequestSchema.parse(payload);

    return SubscriptionConnectStateSchema.parse(requireConnector().connect(request.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectCode, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const request = SubscriptionCodeRequestSchema.parse(payload);
    requireConnector().submitCode(request.connectId, request.code);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectCancel, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    requireConnector().cancel(SubscriptionCancelRequestSchema.parse(payload).connectId);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectOpenPage, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const state = requireConnector().getState(SubscriptionCancelRequestSchema.parse(payload).connectId);

    // Only the sign-in page the CLI printed can be opened, never a URL from the renderer.
    if (state?.url?.startsWith("https://") === true && openExternal !== undefined) {
      await openExternal(state.url);
    }
  });

  ipcMain.handle(IPC_CHANNELS.providersDisconnect, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    const request = SubscriptionDisconnectRequestSchema.parse(payload);
    await requireConnector().disconnect(request.providerId);

    return AiProvidersStatusResponseSchema.parse(await getProvidersStatus({ refresh: true }));
  });

  function requireConnector(): NonNullable<RegisterIpcHandlersOptions["subscriptionConnector"]> {
    if (subscriptionConnector === undefined) {
      throw new Error("Connecting subscriptions is not available.");
    }

    return subscriptionConnector;
  }

  ipcMain.handle(IPC_CHANNELS.talkTranscribe, async (event, payload: unknown) => {
    assertTrustedSurface(event, ["popover"]);
    const request = TalkTranscribeRequestSchema.parse(payload);

    if (talkTranscriber === undefined) {
      throw new Error("Push to talk is not available in this build.");
    }

    return TalkTranscribeResponseSchema.parse(await talkTranscriber.transcribe(request));
  });

  ipcMain.handle(IPC_CHANNELS.talkCaptureContext, async (event) => {
    assertTrustedSurface(event, ["popover"]);
    // Each spoken turn sees the screen as it is now, at the current pointer.
    return contextCollector.collectForRealtime();
  });

  ipcMain.handle(IPC_CHANNELS.browserStatus, (event): BrowserExtensionStatus => {
    assertTrustedSurface(event, ["popover", "desktop"]);

    return (
      browserExtension?.status() ?? { connectedBrowsers: [], extensionPath: null, hostRegistered: false }
    );
  });

  ipcMain.handle(IPC_CHANNELS.browserOpenExtensionFolder, async (event) => {
    assertTrustedSurface(event, ["popover", "desktop"]);
    await browserExtension?.openExtensionFolder();
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
