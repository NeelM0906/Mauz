export const MAUZ_POPUP_SIZE = {
  width: 280,
  height: 180
} as const;

export const MAUZ_ASK_PANEL_SIZE = {
  width: 420,
  height: 520
} as const;

export const LOCAL_API_TOKEN_HEADER = "x-mauz-local-token";

export const IPC_CHANNELS = {
  menuShowMenu: "mauz:menu:show-menu",
  menuClose: "mauz:menu:close",
  menuStartAsk: "mauz:menu:start-ask",
  menuStartTalk: "mauz:menu:start-talk",
  menuStartScreenShare: "mauz:menu:start-screen-share",
  askSubmit: "mauz:ask:submit",
  realtimeCreateSession: "mauz:realtime:create-session",
  activation: "mauz:events:activation",
  permissionError: "mauz:events:permission-error"
} as const;

export const DEFAULT_MAUZ_API_PORT = 38741;
