import { contextBridge, ipcRenderer } from "electron";
import type {
  AskMauzRequest,
  AskMauzResponse,
  MauzBridge,
  MauzDesktopContext,
  PermissionError,
  RealtimeSessionResponse
} from "@mauzai/shared";
import { IPC_CHANNELS, PermissionErrorSchema } from "@mauzai/shared";

const mauzApi: MauzBridge = {
  menu: {
    close: () => ipcRenderer.invoke(IPC_CHANNELS.menuClose) as Promise<void>,
    startAsk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartAsk) as Promise<MauzDesktopContext>,
    startTalk: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartTalk) as Promise<MauzDesktopContext>,
    startScreenShare: () => ipcRenderer.invoke(IPC_CHANNELS.menuStartScreenShare) as Promise<MauzDesktopContext>
  },
  ask: {
    submit: (payload: AskMauzRequest) => ipcRenderer.invoke(IPC_CHANNELS.askSubmit, payload) as Promise<AskMauzResponse>
  },
  realtime: {
    createSession: () => ipcRenderer.invoke(IPC_CHANNELS.realtimeCreateSession) as Promise<RealtimeSessionResponse>
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
