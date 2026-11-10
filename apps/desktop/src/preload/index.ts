import { contextBridge, ipcRenderer } from "electron";
import type { MauzBridge, MauzSettings } from "@mauzai/shared";
import {
  AskAnswerDeltaSchema,
  IPC_CHANNELS,
  SubscriptionConnectStateSchema,
  MauzSettingsSchema,
  PermissionErrorSchema
} from "@mauzai/shared";

type Channel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
type PayloadSchema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

/** Calls the main-process handler. `MauzBridge` gives each call its payload and result types. */
const invoke =
  (channel: Channel) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args);

function subscribe(channel: Channel, listener: (event: Electron.IpcRendererEvent, payload: unknown) => void) {
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

/** An event with no payload. */
const onSignal = (channel: Channel) => (callback: () => void) => subscribe(channel, () => callback());

/** An event whose payload is dropped unless it matches the schema. */
const onPayload =
  <T>(channel: Channel, schema: PayloadSchema<T>) =>
  (callback: (payload: T) => void) =>
    subscribe(channel, (_event, payload) => {
      const parsed = schema.safeParse(payload);
      if (parsed.success) callback(parsed.data);
    });

const mauzApi: MauzBridge = {
  menu: {
    showMenu: invoke(IPC_CHANNELS.menuShowMenu),
    close: invoke(IPC_CHANNELS.menuClose),
    startAsk: invoke(IPC_CHANNELS.menuStartAsk),
    expand: invoke(IPC_CHANNELS.menuExpand),
    onHidden: onSignal(IPC_CHANNELS.menuHidden)
  },
  ask: {
    submit: invoke(IPC_CHANNELS.askSubmit),
    onDelta: onPayload(IPC_CHANNELS.askDelta, AskAnswerDeltaSchema)
  },
  providers: {
    status: invoke(IPC_CHANNELS.providersStatus),
    connect: invoke(IPC_CHANNELS.providersConnect),
    submitCode: invoke(IPC_CHANNELS.providersConnectCode),
    cancelConnect: invoke(IPC_CHANNELS.providersConnectCancel),
    disconnect: invoke(IPC_CHANNELS.providersDisconnect),
    openConnectPage: invoke(IPC_CHANNELS.providersConnectOpenPage),
    onConnectState: onPayload(IPC_CHANNELS.providersConnectState, SubscriptionConnectStateSchema)
  },
  talk: {
    transcribe: invoke(IPC_CHANNELS.talkTranscribe)
  },
  browser: {
    status: invoke(IPC_CHANNELS.browserStatus),
    openExtensionFolder: invoke(IPC_CHANNELS.browserOpenExtensionFolder)
  },
  settings: {
    open: invoke(IPC_CHANNELS.settingsOpen),
    update: (payload) =>
      ipcRenderer
        .invoke(IPC_CHANNELS.settingsUpdate, payload)
        .then((settings: unknown): MauzSettings => MauzSettingsSchema.parse(settings))
  },
  events: {
    onActivation: onSignal(IPC_CHANNELS.activation),
    onPermissionError: onPayload(IPC_CHANNELS.permissionError, PermissionErrorSchema),
    onOpenSettings: onSignal(IPC_CHANNELS.openSettings)
  },
  task: {
    agents: invoke(IPC_CHANNELS.taskAgents),
    folders: invoke(IPC_CHANNELS.taskFolders),
    pickFolder: invoke(IPC_CHANNELS.taskPickFolder),
    send: invoke(IPC_CHANNELS.taskSend)
  }
};

contextBridge.exposeInMainWorld("mauz", mauzApi);
