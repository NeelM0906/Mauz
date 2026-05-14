export const MAUZ_POPUP_SIZE = {
  width: 280,
  height: 180
} as const;

export const IPC_CHANNELS = {
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
