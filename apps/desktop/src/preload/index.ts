import { contextBridge, ipcRenderer } from "electron";
import type {
  AskMauzRequest,
  AskMauzResponse,
  ChatConversation,
  ChatHistoryContinueRequest,
  ChatHistoryContinueResponse,
  ChatHistoryGetRequest,
  ChatHistoryListResponse,
  MauzBridge,
  MauzDesktopContext,
  MauzSettings,
  MauzSettingsOpenOptions,
  MauzSettingsUpdate,
  PermissionError,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSessionResponse
} from "@mauzai/shared";
import { IPC_CHANNELS, MauzSettingsSchema, PermissionErrorSchema } from "@mauzai/shared";

const mauzApi: MauzBridge = {
  menu: {
    showMenu: () => ipcRenderer.invoke(IPC_CHANNELS.menuShowMenu) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.menuClose) as Promise<void>,
    startAsk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartAsk) as Promise<MauzDesktopContext>,
    startTalk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartTalk) as Promise<MauzDesktopContext>
  },
  ask: {
    submit: (payload: AskMauzRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.askSubmit, payload) as Promise<AskMauzResponse>
  },
  history: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.chatHistoryList) as Promise<ChatHistoryListResponse>,
    get: (payload: ChatHistoryGetRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatHistoryGet, payload) as Promise<ChatConversation>,
    continue: (payload: ChatHistoryContinueRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.chatHistoryContinue, payload) as Promise<ChatHistoryContinueResponse>
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
  }
};

contextBridge.exposeInMainWorld("mauz", mauzApi);
