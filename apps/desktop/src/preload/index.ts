import { contextBridge, ipcRenderer } from "electron";
import type {
  AiProvidersStatusRequest,
  AiProvidersStatusResponse,
  AskAnswerDelta,
  BrowserExtensionStatus,
  AskMauzRequest,
  AskMauzResponse,
  MauzBridge,
  MauzDesktopContext,
  MauzSettings,
  MauzSettingsUpdate,
  PermissionError,
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
  TaskSendRequest
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
    expand: () => ipcRenderer.invoke(IPC_CHANNELS.menuExpand) as Promise<void>,
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
      ipcRenderer.invoke(IPC_CHANNELS.talkTranscribe, payload) as Promise<TalkTranscribeResponse>
  },
  browser: {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.browserStatus) as Promise<BrowserExtensionStatus>,
    openExtensionFolder: () => ipcRenderer.invoke(IPC_CHANNELS.browserOpenExtensionFolder) as Promise<void>
  },
  settings: {
    open: () => ipcRenderer.invoke(IPC_CHANNELS.settingsOpen) as Promise<MauzSettings>,
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
    },
    onOpenSettings: (callback) => {
      const listener = (): void => callback();
      ipcRenderer.on(IPC_CHANNELS.openSettings, listener);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.openSettings, listener);
    }
  },
  task: {
    agents: () => ipcRenderer.invoke(IPC_CHANNELS.taskAgents) as Promise<TaskAgentsResponse>,
    folders: (payload: TaskFoldersRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.taskFolders, payload) as Promise<TaskFoldersResponse>,
    pickFolder: () => ipcRenderer.invoke(IPC_CHANNELS.taskPickFolder) as Promise<string | null>,
    send: (payload: TaskSendRequest) => ipcRenderer.invoke(IPC_CHANNELS.taskSend, payload) as Promise<void>
  }
};

contextBridge.exposeInMainWorld("mauz", mauzApi);
