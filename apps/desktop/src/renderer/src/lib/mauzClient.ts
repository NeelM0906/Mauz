import type {
  AgentApprovalPayload,
  AgentRunActivityPayload,
  AgentRunStatePayload,
  AskMauzRequest,
  AskMauzResponse,
  ChatConversation,
  ChatHistoryDeleteRequest,
  ChatHistoryContinueRequest,
  ChatHistoryContinueResponse,
  ChatHistoryGetRequest,
  ChatHistoryListResponse,
  GatewayReadinessResult,
  MauzLensResizeRequest,
  MauzDesktopContext,
  MauzBridge,
  MauzSettingsOpenOptions,
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
    startTalk: async () => collectPreviewContext(),
    setLensExpanded: async (_payload: MauzLensResizeRequest) => {}
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
    },
    delete: async (_payload: ChatHistoryDeleteRequest) => ({
      groups: []
    }),
    clear: async () => ({
      groups: []
    })
  },
  realtime: {
    createSession: async () => {
      throw new Error("Realtime API is not implemented in this milestone.");
    },
    connect: async () => {
      throw new Error("Run the Electron app to talk to Mauz with Realtime.");
    }
  },
  settings: {
    open: async () => ({
      nativeShakeEnabled: true,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal",
      openAiAuthMode: "api-key",
      openAiAuthDisconnected: false,
      openAiCredentialSource: "none",
      askModel: "gpt-5.4-mini",
      chatTitleModel: "gpt-5.4-nano",
      realtimeModel: "gpt-realtime-2",
      realtimeVoice: "marin",
      realtimeReasoningEffort: "low",
      includeFullScreenshot: false,
      apiKeyConfigured: false,
      assistantMode: "simple",
      backendBaseUrl: "",
      agentMode: "approve"
    }),
    update: async (payload: MauzSettingsUpdate) => {
      const openAiAuthDisconnected = payload.openAiAuthDisconnected ?? false;
      const hasDraftApiKey = (payload.openAiApiKey?.trim().length ?? 0) > 0;
      const openAiCredentialSource =
        openAiAuthDisconnected || payload.clearOpenAiApiKey === true || !hasDraftApiKey ? "none" : "saved";

      return {
        nativeShakeEnabled: payload.nativeShakeEnabled ?? true,
        devHotkeyEnabled: payload.devHotkeyEnabled ?? true,
        shakeSensitivity: payload.shakeSensitivity ?? "normal",
        openAiAuthMode: payload.openAiAuthMode ?? "api-key",
        openAiAuthDisconnected,
        openAiCredentialSource,
        askModel: payload.askModel ?? "gpt-5.4-mini",
        chatTitleModel: payload.chatTitleModel ?? "gpt-5.4-nano",
        realtimeModel: payload.realtimeModel ?? "gpt-realtime-2",
        realtimeVoice: payload.realtimeVoice ?? "marin",
        realtimeReasoningEffort: payload.realtimeReasoningEffort ?? "low",
        includeFullScreenshot: payload.includeFullScreenshot ?? false,
        apiKeyConfigured: openAiCredentialSource !== "none",
        assistantMode: payload.assistantMode ?? "simple",
        backendBaseUrl: payload.backendBaseUrl ?? "",
        agentMode: payload.agentMode ?? "approve"
      };
    }
  },
  events: {
    onActivation: () => () => {},
    onPermissionError: () => () => {}
  },
  agent: {
    getGatewayReadinessStatus: async () =>
      ({
        status: "simple",
        message: "Browser preview is using the simple answer flow."
      }) as GatewayReadinessResult,
    respondApproval: async (_payload: unknown) => {},
    stop: async () => {},
    onApprovalRequest: (_callback: (payload: AgentApprovalPayload) => void) => () => {},
    onRunState: (_callback: (payload: AgentRunStatePayload) => void) => () => {},
    onRunActivity: (_callback: (payload: AgentRunActivityPayload) => void) => () => {}
  }
};

function getBridge(): MauzBridge {
  const bridge = (window as WindowWithOptionalBridge).mauz;

  if (bridge !== undefined) {
    return bridge;
  }

  if (isDesktopRenderer()) {
    throw new Error("Mauz desktop bridge is unavailable. Quit and reopen the installed MauzAI app.");
  }

  return browserPreviewBridge;
}

function isDesktopRenderer(): boolean {
  return navigator.userAgent.includes("Electron") || window.location.protocol === "file:";
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
  setLensExpanded(payload: MauzLensResizeRequest): Promise<void> {
    return getBridge().menu.setLensExpanded(payload);
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
  deleteChat(payload: ChatHistoryDeleteRequest): Promise<ChatHistoryListResponse> {
    return getBridge().history.delete(payload);
  },
  clearChatHistory(): Promise<ChatHistoryListResponse> {
    return getBridge().history.clear();
  },
  createRealtimeSession(): Promise<RealtimeSessionResponse> {
    return getBridge().realtime.createSession();
  },
  connectRealtime(payload: RealtimeConnectRequest): Promise<RealtimeConnectResponse> {
    return getBridge().realtime.connect(payload);
  },
  openSettings(options?: MauzSettingsOpenOptions): Promise<MauzSettings> {
    return getBridge().settings.open(options);
  },
  updateSettings(payload: MauzSettingsUpdate): Promise<MauzSettings> {
    return getBridge().settings.update(payload);
  },
  onActivation(callback: () => void): () => void {
    return getBridge().events.onActivation(callback);
  },
  onPermissionError(callback: (error: PermissionError) => void): () => void {
    return getBridge().events.onPermissionError(callback);
  },
  onAgentApprovalRequest(callback: (payload: AgentApprovalPayload) => void): () => void {
    return getBridge().agent.onApprovalRequest(callback);
  },
  respondAgentApproval(payload: { approvalId: string; choice: string }): Promise<void> {
    return getBridge().agent.respondApproval(payload);
  },
  onAgentRunState(callback: (payload: AgentRunStatePayload) => void): () => void {
    return getBridge().agent.onRunState(callback);
  },
  onAgentRunActivity(callback: (payload: AgentRunActivityPayload) => void): () => void {
    return getBridge().agent.onRunActivity(callback);
  },
  stopAgentRun(): Promise<void> {
    return getBridge().agent.stop();
  },
  getGatewayReadinessStatus(): Promise<GatewayReadinessResult> {
    return getBridge().agent.getGatewayReadinessStatus();
  }
};
