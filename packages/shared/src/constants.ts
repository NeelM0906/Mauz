export const MAUZ_POPUP_SIZE = {
  width: 280,
  height: 218
} as const;

export const MAUZ_ASK_PANEL_SIZE = {
  width: 420,
  height: 520
} as const;

export const MAUZ_SETTINGS_PANEL_SIZE = {
  width: 360,
  height: 330
} as const;

export const MAUZ_HISTORY_PANEL_SIZE = {
  width: 420,
  height: 520
} as const;

export const MAUZ_REALTIME_PANEL_SIZE = {
  width: 380,
  height: 440
} as const;

export const LOCAL_API_TOKEN_HEADER = "x-mauz-local-token";

export const IPC_CHANNELS = {
  menuShowMenu: "mauz:menu:show-menu",
  menuClose: "mauz:menu:close",
  menuStartAsk: "mauz:menu:start-ask",
  menuStartTalk: "mauz:menu:start-talk",
  menuStartScreenShare: "mauz:menu:start-screen-share",
  settingsOpen: "mauz:settings:open",
  settingsUpdate: "mauz:settings:update",
  askSubmit: "mauz:ask:submit",
  chatHistoryList: "mauz:chat-history:list",
  chatHistoryGet: "mauz:chat-history:get",
  realtimeCreateSession: "mauz:realtime:create-session",
  realtimeConnect: "mauz:realtime:connect",
  realtimeCaptureFrame: "mauz:realtime:capture-frame",
  activation: "mauz:events:activation",
  permissionError: "mauz:events:permission-error"
} as const;

export const DEFAULT_MAUZ_API_PORT = 47891;
