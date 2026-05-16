export const MAUZ_POPUP_SIZE = {
  width: 280,
  height: 248
} as const;

export const MAUZ_ASK_PANEL_SIZE = {
  width: 420,
  height: 520
} as const;

export const MAUZ_SETTINGS_PANEL_SIZE = {
  width: 440,
  height: 620
} as const;

export const MAUZ_HISTORY_PANEL_SIZE = {
  width: 420,
  height: 520
} as const;

export const MAUZ_REALTIME_PANEL_SIZE = {
  width: 380,
  height: 480
} as const;

export const LOCAL_API_TOKEN_HEADER = "x-mauz-local-token";

export const IPC_CHANNELS = {
  menuShowMenu: "mauz:menu:show-menu",
  menuClose: "mauz:menu:close",
  menuStartAsk: "mauz:menu:start-ask",
  menuStartTalk: "mauz:menu:start-talk",
  settingsOpen: "mauz:settings:open",
  settingsUpdate: "mauz:settings:update",
  settingsOpenAiAuthStatus: "mauz:settings:openai-auth-status",
  settingsStartOpenAiLogin: "mauz:settings:start-openai-login",
  askSubmit: "mauz:ask:submit",
  chatHistoryList: "mauz:chat-history:list",
  chatHistoryGet: "mauz:chat-history:get",
  chatHistoryContinue: "mauz:chat-history:continue",
  realtimeCreateSession: "mauz:realtime:create-session",
  realtimeConnect: "mauz:realtime:connect",
  activation: "mauz:events:activation",
  permissionError: "mauz:events:permission-error"
} as const;

export const DEFAULT_MAUZ_API_PORT = 47891;
