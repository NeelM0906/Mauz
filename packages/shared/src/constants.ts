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
  menuSetLensExpanded: "mauz:menu:set-lens-expanded",
  settingsOpen: "mauz:settings:open",
  settingsUpdate: "mauz:settings:update",
  askSubmit: "mauz:ask:submit",
  agentApprovalRequest: "mauz:agent:approval-request",
  agentApprovalRespond: "mauz:agent:approval-respond",
  agentRunState: "mauz:agent:run-state",
  agentRunActivity: "mauz:agent:run-activity",
  agentStop: "mauz:agent:stop",
  chatHistoryList: "mauz:chat-history:list",
  chatHistoryGet: "mauz:chat-history:get",
  chatHistoryContinue: "mauz:chat-history:continue",
  chatHistoryDelete: "mauz:chat-history:delete",
  chatHistoryClear: "mauz:chat-history:clear",
  realtimeCreateSession: "mauz:realtime:create-session",
  realtimeConnect: "mauz:realtime:connect",
  activation: "mauz:events:activation",
  permissionError: "mauz:events:permission-error"
} as const;

export const DEFAULT_MAUZ_API_PORT = 47891;

export const DEFAULT_HERMES_BASE_URL = "http://localhost:8642/v1";
