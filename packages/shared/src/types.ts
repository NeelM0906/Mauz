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

export type RealtimeMode = "talk" | "screen";

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

export type MauzSettings = {
  nativeShakeEnabled: boolean;
  devHotkeyEnabled: boolean;
  shakeSensitivity: ShakeSensitivity;
  openAiAuthMode: OpenAiAuthMode;
  askModel: string;
  chatTitleModel: string;
  realtimeModel: string;
  realtimeVoice: string;
  realtimeReasoningEffort: RealtimeReasoningEffort;
  includeFullScreenshot: boolean;
  apiKeyConfigured: boolean;
};

export type MauzSettingsUpdate = Partial<Omit<MauzSettings, "apiKeyConfigured">>;

export type MouseMoveSample = {
  x: number;
  y: number;
  ts: number;
  buttons?: number | undefined;
};

export type MauzBridge = {
  menu: {
    showMenu(): Promise<void>;
    close(): Promise<void>;
    startAsk(): Promise<MauzDesktopContext>;
    startTalk(): Promise<MauzDesktopContext>;
    startScreenShare(): Promise<MauzDesktopContext>;
  };
  ask: {
    submit(payload: AskMauzRequest): Promise<AskMauzResponse>;
  };
  history: {
    list(): Promise<ChatHistoryListResponse>;
    get(payload: ChatHistoryGetRequest): Promise<ChatConversation>;
    continue(payload: ChatHistoryContinueRequest): Promise<ChatHistoryContinueResponse>;
  };
  realtime: {
    createSession(): Promise<RealtimeSessionResponse>;
    connect(payload: RealtimeConnectRequest): Promise<RealtimeConnectResponse>;
    captureFrame(): Promise<MauzDesktopContext>;
  };
  settings: {
    open(): Promise<MauzSettings>;
    update(payload: MauzSettingsUpdate): Promise<MauzSettings>;
  };
  events: {
    onActivation(callback: () => void): () => void;
    onPermissionError(callback: (error: PermissionError) => void): () => void;
  };
};
