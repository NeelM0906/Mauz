import type {
  AskMauzRequest,
  AskMauzResponse,
  ChatConversation,
  ChatHistoryContinueRequest,
  ChatHistoryContinueResponse,
  ChatHistoryGetRequest,
  ChatHistoryListResponse,
  MauzDesktopContext,
  MauzBridge,
  Platform,
  MauzSettings,
  MauzSettingsUpdate,
  PermissionError,
  RealtimeConnectRequest,
  RealtimeConnectResponse,
  RealtimeSessionResponse
} from "@mauzai/shared";

type WindowWithOptionalBridge = Window & {
  mauz?: MauzBridge;
};

const browserPreviewBridge: MauzBridge = {
  menu: {
    showMenu: async () => {},
    close: async () => {},
    startAsk: async () => collectPreviewContext(),
    startTalk: async () => {
      throw new Error("Still working on this.");
    },
    startScreenShare: async () => {
      throw new Error("Still working on this.");
    }
  },
  ask: {
    submit: async (_payload: AskMauzRequest) => {
      return {
        answer:
          "Browser preview is connected. Run the Electron app to ask Mauz with live screenshot context.",
        model: "preview"
      };
    }
  },
  history: {
    list: async () => ({
      groups: []
    }),
    get: async (_payload: ChatHistoryGetRequest) => {
      throw new Error("Run the Electron app to view Mauz chat history.");
    },
    continue: async (_payload: ChatHistoryContinueRequest) => {
      throw new Error("Run the Electron app to continue Mauz chat history.");
    }
  },
  realtime: {
    createSession: async () => {
      throw new Error("Realtime API is not implemented in this milestone.");
    },
    connect: async () => {
      throw new Error("Run the Electron app to talk to Mauz with Realtime.");
    },
    captureFrame: async () => collectPreviewContext()
  },
  settings: {
    open: async () => ({
      nativeShakeEnabled: true,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal",
      openAiAuthMode: "api-key",
      askModel: "gpt-5.4-mini",
      chatTitleModel: "gpt-5.4-nano",
      realtimeModel: "gpt-realtime-2",
      realtimeVoice: "marin",
      realtimeReasoningEffort: "low",
      includeFullScreenshot: false,
      apiKeyConfigured: false
    }),
    update: async (payload: MauzSettingsUpdate) => ({
      nativeShakeEnabled: payload.nativeShakeEnabled ?? true,
      devHotkeyEnabled: payload.devHotkeyEnabled ?? true,
      shakeSensitivity: payload.shakeSensitivity ?? "normal",
      openAiAuthMode: payload.openAiAuthMode ?? "api-key",
      askModel: payload.askModel ?? "gpt-5.4-mini",
      chatTitleModel: payload.chatTitleModel ?? "gpt-5.4-nano",
      realtimeModel: payload.realtimeModel ?? "gpt-realtime-2",
      realtimeVoice: payload.realtimeVoice ?? "marin",
      realtimeReasoningEffort: payload.realtimeReasoningEffort ?? "low",
      includeFullScreenshot: payload.includeFullScreenshot ?? false,
      apiKeyConfigured:
        payload.clearOpenAiApiKey === true ? false : (payload.openAiApiKey?.trim().length ?? 0) > 0
    })
  },
  events: {
    onActivation: () => () => {},
    onPermissionError: () => () => {}
  }
};

function getBridge(): MauzBridge {
  return (window as WindowWithOptionalBridge).mauz ?? browserPreviewBridge;
}

function collectPreviewContext(): MauzDesktopContext {
  return {
    timestamp: new Date().toISOString(),
    platform: getPreviewPlatform(),
    cursor: {
      x: 0,
      y: 0
    }
  };
}

function getPreviewPlatform(): Platform {
  const platform = navigator.platform.toLowerCase();

  if (platform.includes("mac")) {
    return "darwin";
  }

  if (platform.includes("win")) {
    return "win32";
  }

  return "linux";
}

export const mauzClient = {
  showMenu(): Promise<void> {
    return getBridge().menu.showMenu();
  },
  close(): Promise<void> {
    return getBridge().menu.close();
  },
  startAsk(): Promise<MauzDesktopContext> {
    return getBridge().menu.startAsk();
  },
  startTalk(): Promise<MauzDesktopContext> {
    return getBridge().menu.startTalk();
  },
  startScreenShare(): Promise<MauzDesktopContext> {
    return getBridge().menu.startScreenShare();
  },
  submitAsk(payload: AskMauzRequest): Promise<AskMauzResponse> {
    return getBridge().ask.submit(payload);
  },
  listChatHistory(): Promise<ChatHistoryListResponse> {
    return getBridge().history.list();
  },
  getChatConversation(payload: ChatHistoryGetRequest): Promise<ChatConversation> {
    return getBridge().history.get(payload);
  },
  continueChat(payload: ChatHistoryContinueRequest): Promise<ChatHistoryContinueResponse> {
    return getBridge().history.continue(payload);
  },
  createRealtimeSession(): Promise<RealtimeSessionResponse> {
    return getBridge().realtime.createSession();
  },
  connectRealtime(payload: RealtimeConnectRequest): Promise<RealtimeConnectResponse> {
    return getBridge().realtime.connect(payload);
  },
  captureRealtimeFrame(): Promise<MauzDesktopContext> {
    return getBridge().realtime.captureFrame();
  },
  openSettings(): Promise<MauzSettings> {
    return getBridge().settings.open();
  },
  updateSettings(payload: MauzSettingsUpdate): Promise<MauzSettings> {
    return getBridge().settings.update(payload);
  },
  onActivation(callback: () => void): () => void {
    return getBridge().events.onActivation(callback);
  },
  onPermissionError(callback: (error: PermissionError) => void): () => void {
    return getBridge().events.onPermissionError(callback);
  }
};
