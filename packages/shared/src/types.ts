export type Platform = "darwin" | "win32" | "linux";

export type ScreenshotPayload = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  width: number;
  height: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PointerContext = {
  cursor: {
    x: number;
    y: number;
  };
  display?:
    | {
        id?: string | undefined;
        scaleFactor?: number | undefined;
        bounds?: Bounds | undefined;
      }
    | undefined;
  activeApp?:
    | {
        name?: string | undefined;
        bundleId?: string | undefined;
        processId?: number | undefined;
      }
    | undefined;
  activeWindow?:
    | {
        title?: string | undefined;
        bounds?: Bounds | undefined;
      }
    | undefined;
  selectedText?: string | undefined;
  cursorCrop?: ScreenshotPayload | undefined;
  screenshot?: ScreenshotPayload | undefined;
};

export type MauzDesktopContext = {
  timestamp: string;
  platform: Platform;
  activeApp?:
    | {
        name?: string | undefined;
        bundleId?: string | undefined;
        processId?: number | undefined;
      }
    | undefined;
  activeWindow?:
    | {
        title?: string | undefined;
        bounds?:
          | {
              x: number;
              y: number;
              width: number;
              height: number;
            }
          | undefined;
      }
    | undefined;
  cursor: {
    x: number;
    y: number;
  };
  selectedText?: string | undefined;
  pointer?: PointerContext | undefined;
  screenshot?: ScreenshotPayload | undefined;
  screenshotError?: PermissionError | undefined;
};

export type AskMauzRequest = {
  question: string;
  context: MauzDesktopContext;
  conversationMessages?: ChatMessage[] | undefined;
  sessionId?: string | undefined;
};

export type AskMauzResponse = {
  answer: string;
  model: string;
  conversationId?: string | undefined;
  conversationTitle?: string | undefined;
  usage?: unknown | undefined;
};

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

export type ChatConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type ChatHistorySummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
};

export type ChatHistoryGroup = {
  dateLabel: string;
  conversations: ChatHistorySummary[];
};

export type ChatHistoryListResponse = {
  groups: ChatHistoryGroup[];
};

export type ChatHistoryGetRequest = {
  id: string;
};

export type ChatHistoryDeleteRequest = {
  id: string;
};

export type ChatHistoryContinueRequest = {
  id: string;
  question: string;
};

export type ChatHistoryContinueResponse = {
  conversation: ChatConversation;
  answer: string;
  model: string;
};

export type ChatTitleRequest = {
  question: string;
  answer: string;
};

export type ChatTitleResponse = {
  title: string;
  model: string;
};

export type RealtimeSessionResponse = {
  value: string;
  expires_at?: number | undefined;
  session?: unknown | undefined;
};

export type RealtimeMode = "talk";

export type RealtimeConnectRequest = {
  offerSdp: string;
  mode: RealtimeMode;
  context: MauzDesktopContext;
};

export type RealtimeConnectResponse = {
  answerSdp: string;
  model: string;
};

export type PermissionError = {
  permission: "accessibility" | "screen-recording" | "microphone" | "unknown";
  message: string;
};

export type ShakeSensitivity = "relaxed" | "normal" | "strict";

export type RealtimeReasoningEffort = "low" | "medium" | "high";

export type OpenAiAuthMode = "api-key";
export type OpenAiCredentialSource = "none" | "environment" | "saved";

export type AssistantMode = "simple" | "agentic";
export type AgentMode = "approve" | "yolo";

export type MauzSettings = {
  nativeShakeEnabled: boolean;
  devHotkeyEnabled: boolean;
  shakeSensitivity: ShakeSensitivity;
  openAiAuthMode: OpenAiAuthMode;
  openAiAuthDisconnected: boolean;
  openAiCredentialSource: OpenAiCredentialSource;
  askModel: string;
  chatTitleModel: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeReasoningEffort: RealtimeReasoningEffort;
  includeFullScreenshot: boolean;
  apiKeyConfigured: boolean;
  assistantMode: AssistantMode;
  backendBaseUrl: string;
  agentMode: AgentMode;
};

export type MauzSettingsUpdate = Partial<
  Omit<MauzSettings, "apiKeyConfigured" | "openAiCredentialSource">
> & {
  openAiApiKey?: string | null | undefined;
  clearOpenAiApiKey?: boolean | undefined;
};

export type MauzSettingsOpenOptions = {
  resizePopover?: boolean | undefined;
};

export type MauzLensResizeRequest = {
  expanded: boolean;
};

export type MouseMoveSample = {
  x: number;
  y: number;
  ts: number;
  buttons?: number | undefined;
};

export type AgentApprovalPayload = {
  approvalId: string;
  runId: string;
  description: string;
};

export type AgentRunStatePayload = {
  runId: string | null;
};

export type AgentRunActivityPayload = {
  runId: string;
  kind: "tool.started" | "tool.completed" | "reasoning";
  tool?: string | undefined;
  label: string;
};

export type GatewayReadinessStatus = "simple" | "ready" | "unavailable" | "unsupported";

export type GatewayReadinessResult = {
  status: GatewayReadinessStatus;
  message: string;
};

export type MauzBridge = {
  menu: {
    showMenu(): Promise<void>;
    close(): Promise<void>;
    startAsk(): Promise<MauzDesktopContext>;
    startTalk(): Promise<MauzDesktopContext>;
    setLensExpanded(payload: MauzLensResizeRequest): Promise<void>;
  };
  ask: {
    submit(payload: AskMauzRequest): Promise<AskMauzResponse>;
  };
  history: {
    list(): Promise<ChatHistoryListResponse>;
    get(payload: ChatHistoryGetRequest): Promise<ChatConversation>;
    continue(payload: ChatHistoryContinueRequest): Promise<ChatHistoryContinueResponse>;
    delete(payload: ChatHistoryDeleteRequest): Promise<ChatHistoryListResponse>;
    clear(): Promise<ChatHistoryListResponse>;
  };
  realtime: {
    createSession(): Promise<RealtimeSessionResponse>;
    connect(payload: RealtimeConnectRequest): Promise<RealtimeConnectResponse>;
  };
  settings: {
    open(options?: MauzSettingsOpenOptions): Promise<MauzSettings>;
    update(payload: MauzSettingsUpdate): Promise<MauzSettings>;
  };
  events: {
    onActivation(callback: () => void): () => void;
    onPermissionError(callback: (error: PermissionError) => void): () => void;
  };
  agent: {
    getGatewayReadinessStatus(): Promise<GatewayReadinessResult>;
    respondApproval(payload: unknown): Promise<void>;
    stop(): Promise<void>;
    onApprovalRequest(callback: (payload: AgentApprovalPayload) => void): () => void;
    onRunState(callback: (payload: AgentRunStatePayload) => void): () => void;
    onRunActivity(callback: (payload: AgentRunActivityPayload) => void): () => void;
  };
};
