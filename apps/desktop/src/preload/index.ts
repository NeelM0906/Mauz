import { contextBridge, ipcRenderer } from "electron";
import type {
  AiProvidersStatusRequest,
  AiProvidersStatusResponse,
  AskAnswerDelta,
  BrowserExtensionStatus,
  AskMauzRequest,
  AskMauzResponse,
  ChatConversation,
  ChatHistoryDeleteRequest,
  ChatHistoryContinueRequest,
  ChatHistoryContinueResponse,
  ChatHistoryGetRequest,
  ChatHistoryListResponse,
  MauzLensResizeRequest,
  MauzBridge,
  MauzDesktopContext,
  MauzSettings,
  MauzSettingsOpenOptions,
  MauzSettingsUpdate,
  PermissionError,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSessionResponse,
  SubscriptionCancelRequest,
  SubscriptionCodeRequest,
  SubscriptionConnectRequest,
  SubscriptionConnectState,
  SubscriptionDisconnectRequest,
  TalkTranscribeRequest,
  TalkTranscribeResponse,
  TaskAgentsResponse,
  TaskFoldersRequest,
  TaskFoldersResponse,
  TaskSendRequest,
  TaskSendResponse
} from "@mauzai/shared";
import {
  AskAnswerDeltaSchema,
  IPC_CHANNELS,
  SubscriptionConnectStateSchema,
  MauzSettingsSchema,
  PermissionErrorSchema
} from "@mauzai/shared";

const mauzApi: MauzBridge = {
  menu: {
    showMenu: () => ipcRenderer.invoke(IPC_CHANNELS.menuShowMenu) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.menuClose) as Promise<void>,
    startAsk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartAsk) as Promise<MauzDesktopContext>,
    startTalk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartTalk) as Promise<MauzDesktopContext>,
    selectRegion: () =>
      ipcRenderer.invoke(IPC_CHANNELS.menuSelectRegion) as Promise<MauzDesktopContext | null>,
    setLensExpanded: (payload: MauzLensResizeRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.menuSetLensExpanded, payload) as Promise<void>,
    onHidden: (callback: () => void) => {
      const listener = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.menuHidden, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.menuHidden, listener);
    }
  },
  ask: {
    submit: (payload: AskMauzRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.askSubmit, payload) as Promise<AskMauzResponse>,
    onDelta: (callback: (payload: AskAnswerDelta) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const parsed = AskAnswerDeltaSchema.safeParse(payload);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.askDelta, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.askDelta, listener);
    }
  },
  providers: {
    status: (payload?: AiProvidersStatusRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersStatus, payload) as Promise<AiProvidersStatusResponse>,
    connect: (payload: SubscriptionConnectRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersConnect, payload) as Promise<SubscriptionConnectState>,
    submitCode: (payload: SubscriptionCodeRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersConnectCode, payload) as Promise<void>,
    cancelConnect: (payload: SubscriptionCancelRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersConnectCancel, payload) as Promise<void>,
    disconnect: (payload: SubscriptionDisconnectRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersDisconnect, payload) as Promise<AiProvidersStatusResponse>,
    openConnectPage: (payload: SubscriptionCancelRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.providersConnectOpenPage, payload) as Promise<void>,
    onConnectState: (callback: (state: SubscriptionConnectState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const parsed = SubscriptionConnectStateSchema.safeParse(payload);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.providersConnectState, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.providersConnectState, listener);
    }
  },
  talk: {
    transcribe: (payload: TalkTranscribeRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.talkTranscribe, payload) as Promise<TalkTranscribeResponse>,
    captureContext: () => ipcRenderer.invoke(IPC_CHANNELS.talkCaptureContext) as Promise<MauzDesktopContext>
  },
  browser: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.browserStatus) as Promise<BrowserExtensionStatus>,
    openExtensionFolder: () => ipcRenderer.invoke(IPC_CHANNELS.browserOpenExtensionFolder) as Promise<void>
  },
  history: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.chatHistoryList) as Promise<ChatHistoryListResponse>,
    get: (payload: ChatHistoryGetRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatHistoryGet, payload) as Promise<ChatConversation>,
    continue: (payload: ChatHistoryContinueRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatHistoryContinue, payload) as Promise<ChatHistoryContinueResponse>,
    delete: (payload: ChatHistoryDeleteRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatHistoryDelete, payload) as Promise<ChatHistoryListResponse>,
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.chatHistoryClear) as Promise<ChatHistoryListResponse>
  },
  realtime: {
    createSession: () =>
      ipcRenderer.invoke(IPC_CHANNELS.realtimeCreateSession) as Promise<RealtimeSessionResponse>,
    connect: (payload: RealtimeConnectRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.realtimeConnect, payload) as Promise<RealtimeConnectResponse>
  },
  settings: {
    open: (options?: MauzSettingsOpenOptions) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsOpen, options) as Promise<MauzSettings>,
    update: (payload: MauzSettingsUpdate) =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, payload).then((settings: unknown) => {
        const parsed = MauzSettingsSchema.parse(settings);
        return parsed;
      }) as Promise<MauzSettings>
  },
  events: {
    onActivation: (callback) => {
      const listener = (): void => {
        callback();
      };

      ipcRenderer.on(IPC_CHANNELS.activation, listener);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.activation, listener);
      };
    },
    onPermissionError: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
        const parsed = PermissionErrorSchema.safeParse(payload);

        if (parsed.success) {
          callback(parsed.data);
        }
      };

      ipcRenderer.on(IPC_CHANNELS.permissionError, listener);

      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.permissionError, listener);
      };
    }
  },
  task: {
    agents: () => ipcRenderer.invoke(IPC_CHANNELS.taskAgents) as Promise<TaskAgentsResponse>,
    folders: (payload: TaskFoldersRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.taskFolders, payload) as Promise<TaskFoldersResponse>,
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.taskPickFolder) as Promise<string | null>,
    send: (payload: TaskSendRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.taskSend, payload) as Promise<TaskSendResponse>
  }
};

contextBridge.exposeInMainWorld("mauz", mauzApi);
