export const MAUZ_POPUP_SIZE = {
  width: 330,
  height: 390
} as const;

export const MAUZ_ASK_PANEL_SIZE = {
  width: 440,
  height: 590
} as const;

export const MAUZ_SETTINGS_PANEL_SIZE = {
  width: 440,
  height: 620
} as const;

export const IPC_CHANNELS = {
  menuShowMenu: "mauz:menu:show-menu",
  menuClose: "mauz:menu:close",
  menuStartAsk: "mauz:menu:start-ask",
  menuExpand: "mauz:menu:expand",
  menuHidden: "mauz:menu:hidden",
  settingsOpen: "mauz:settings:open",
  settingsUpdate: "mauz:settings:update",
  askSubmit: "mauz:ask:submit",
  askDelta: "mauz:ask:delta",
  providersStatus: "mauz:providers:status",
  providersConnect: "mauz:providers:connect",
  providersConnectCode: "mauz:providers:connect-code",
  providersConnectCancel: "mauz:providers:connect-cancel",
  providersConnectOpenPage: "mauz:providers:connect-open-page",
  providersConnectState: "mauz:providers:connect-state",
  providersDisconnect: "mauz:providers:disconnect",
  dictateTranscribe: "mauz:dictate:transcribe",
  browserStatus: "mauz:browser:status",
  browserOpenExtensionFolder: "mauz:browser:open-extension-folder",
  taskAgents: "mauz:task:agents",
  taskFolders: "mauz:task:folders",
  taskPickFolder: "mauz:task:pick-folder",
  taskSend: "mauz:task:send",
  activation: "mauz:events:activation",
  permissionError: "mauz:events:permission-error",
  openSettings: "mauz:events:open-settings"
} as const;
