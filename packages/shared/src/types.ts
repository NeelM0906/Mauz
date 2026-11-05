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

/** Something on screen read from the app itself (UI Automation, Accessibility, or a browser). */
export type PointerTargetElement = {
  /** Control type, e.g. "Button", "Text", "Hyperlink", "Edit", "ListItem". */
  role: string;
  name?: string | undefined;
  /** Never read from password fields. */
  value?: string | undefined;
  /** Paragraph at the pointer for the element; descendant text for a container. */
  text?: string | undefined;
  bounds?: Bounds | undefined;
};

export type PointerTargetSource = "windows-uia" | "macos-ax" | "browser";

/** The element under the pointer, the group around it, and the window it belongs to. */
export type PointerTarget = {
  source: PointerTargetSource;
  element: PointerTargetElement;
  container?: PointerTargetElement | undefined;
  window?:
    | {
        title?: string | undefined;
        appName?: string | undefined;
        executable?: string | undefined;
        processId?: number | undefined;
        bounds?: Bounds | undefined;
      }
    | undefined;
};

export type CursorCropFocus = {
  /**
   * "element": framed on the pointed element or its group; "pointer-area": a fixed area around
   * the pointer; "region": exactly the area the user selected.
   */
  kind: "element" | "pointer-area" | "region";
  /** Pointer position in the crop's pixels. */
  pointer: {
    x: number;
    y: number;
  };
};

export type CaptureBlocked = {
  appName: string;
};

/** Structured product data a shop page publishes for search engines (schema.org, Open Graph). */
export type BrowserProduct = {
  name?: string | undefined;
  brand?: string | undefined;
  sku?: string | undefined;
  gtin?: string | undefined;
  color?: string | undefined;
  size?: string | undefined;
  material?: string | undefined;
  price?: string | undefined;
  priceCurrency?: string | undefined;
  lowPrice?: string | undefined;
  highPrice?: string | undefined;
  availability?: string | undefined;
  rating?: string | undefined;
  reviewCount?: string | undefined;
  seller?: string | undefined;
};

/** The page under the pointer, read by the Mauz browser extension. */
export type BrowserPage = {
  /** "Google Chrome", "Microsoft Edge", ... */
  browser: string;
  url: string;
  title?: string | undefined;
  selection?: string | undefined;
  /** The element under the pointer. */
  element?:
    | {
        tag: string;
        role?: string | undefined;
        text?: string | undefined;
        href?: string | undefined;
        alt?: string | undefined;
      }
    | undefined;
  /** Text of the card or section around the pointed element. */
  around?: string | undefined;
  /** Main text of the page. */
  text?: string | undefined;
  product?: BrowserProduct | undefined;
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
  target?: PointerTarget | undefined;
  cursorCrop?: ScreenshotPayload | undefined;
  cursorCropFocus?: CursorCropFocus | undefined;
  /** Text recognized in the cursor crop (Windows OCR) when the app exposed none. */
  ocrText?: string | undefined;
  page?: BrowserPage | undefined;
  /** Image of the window under the pointer; sent only when there is no cursor crop. */
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
  /** The app is on the user's never-capture list; no pixels, text, or window title were collected. */
  captureBlocked?: CaptureBlocked | undefined;
};

export type AskMauzRequest = {
  question: string;
  context: MauzDesktopContext;
  conversationMessages?: ChatMessage[] | undefined;
  sessionId?: string | undefined;
  requestId?: string | undefined;
  responseStyle?: AskResponseStyle | undefined;
};

/** "voice" answers are written to be spoken aloud (Talk); "text" answers may use Markdown. */
export type AskResponseStyle = "text" | "voice";

export type AskAnswerDelta = {
  requestId: string;
  text: string;
};

export type AiProviderId = "claude-code" | "codex" | "anthropic" | "openai";
export type AiProviderPreference = "auto" | AiProviderId;
/** Provider to use when the default is not ready or fails before answering. */
export type AiFallbackPreference = "none" | AiProviderId;
export type AiProviderKind = "subscription" | "api-key";

export type AiProviderStatus = {
  id: AiProviderId;
  label: string;
  kind: AiProviderKind;
  available: boolean;
  detail: string;
  model: string;
};

export type AiProvidersStatusResponse = {
  preference: AiProviderPreference;
  fallbackPreference: AiFallbackPreference;
  activeProviderId: AiProviderId | null;
  /** Ready fallback that differs from the active provider, or null. */
  fallbackProviderId: AiProviderId | null;
  providers: AiProviderStatus[];
};

export type SubscriptionProviderId = "claude-code" | "codex";

export type SubscriptionConnectPhase =
  | "installing"
  | "starting"
  | "waiting"
  | "connected"
  | "failed"
  | "cancelled";

/** Progress of connecting a subscription from inside Mauz (install the CLI if needed, then sign in). */
export type SubscriptionConnectState = {
  connectId: string;
  providerId: SubscriptionProviderId;
  phase: SubscriptionConnectPhase;
  /** Sign-in page to open in the browser. */
  url: string | null;
  /** One-time code to enter on the sign-in page (device sign-in). */
  userCode: string | null;
  /** The sign-in page may show a code that has to be pasted back into Mauz. */
  acceptsPastedCode: boolean;
  message: string | null;
};

export type SubscriptionConnectRequest = {
  providerId: SubscriptionProviderId;
};

export type SubscriptionCodeRequest = {
  connectId: string;
  code: string;
};

export type SubscriptionCancelRequest = {
  connectId: string;
};

export type SubscriptionDisconnectRequest = {
  providerId: SubscriptionProviderId;
};

export type AiProvidersStatusRequest = {
  refresh?: boolean | undefined;
};

export type TalkTranscribeRequest = {
  audioBase64: string;
  mimeType: "audio/wav";
};

export type TalkTranscriptionEngine = "openai" | "windows";

export type TalkTranscribeResponse = {
  text: string;
  engine: TalkTranscriptionEngine;
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

export type TalkEngine = "pipeline" | "realtime";

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
  /** Executable names (Windows) or bundle ids (macOS) Mauz never captures. */
  captureBlockedApps: string[];
  /** Sites (example.com, *bank*) whose pages Mauz never reads or screenshots. */
  captureBlockedSites: string[];
  apiKeyConfigured: boolean;
  /** The coding agent Send to agent hands tasks to; "auto" picks the first one installed. */
  taskAgent: TaskAgentPreference;
  /** Folder an agent starts in when none was picked; empty means the home folder. */
  taskFolder: string;
  /** The folder last used with each agent. */
  taskAgentFolders: Partial<Record<TaskAgentId, string>>;
  aiProvider: AiProviderPreference;
  aiFallbackProvider: AiFallbackPreference;
  anthropicKeyConfigured: boolean;
  talkEngine: TalkEngine;
};

export type MauzSettingsUpdate = Partial<
  Omit<MauzSettings, "apiKeyConfigured" | "openAiCredentialSource" | "anthropicKeyConfigured">
> & {
  openAiApiKey?: string | null | undefined;
  clearOpenAiApiKey?: boolean | undefined;
  anthropicApiKey?: string | null | undefined;
  clearAnthropicApiKey?: boolean | undefined;
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

export type TaskAgentId = "hermes" | "claude-code" | "codex";
export type TaskAgentPreference = "auto" | TaskAgentId;

export type TaskAgentStatus = {
  id: TaskAgentId;
  label: string;
  installed: boolean;
};

export type TaskAgentsResponse = {
  agents: TaskAgentStatus[];
  /** The agent Send to agent uses: the setting, or the first installed one for "auto". */
  selectedAgentId: TaskAgentId | null;
};

export type TaskFolder = {
  path: string;
  name: string;
};

export type TaskFoldersRequest = {
  agentId: TaskAgentId;
};

export type TaskFoldersResponse = {
  /** Folders the agent has worked in, most recent first. */
  folders: TaskFolder[];
  /** The folder to preselect: the last one used with this agent, or the default work folder. */
  selectedPath: string;
};

export type TaskSendRequest = {
  agentId: TaskAgentId;
  folder: string;
  task: string;
  context: MauzDesktopContext;
};

export type TaskSendResponse = {
  agentLabel: string;
};

export type BrowserExtensionStatus = {
  /** Browsers whose Mauz extension is connected now. */
  connectedBrowsers: string[];
  /** Folder to load as an unpacked extension, or null if Mauz cannot find it. */
  extensionPath: string | null;
  /** Whether Chrome and Edge know how to start the Mauz native messaging host. */
  hostRegistered: boolean;
};

export type MauzBridge = {
  menu: {
    showMenu(): Promise<void>;
    close(): Promise<void>;
    startAsk(): Promise<MauzDesktopContext>;
    startTalk(): Promise<MauzDesktopContext>;
    /** Lets the user drag a rectangle on screen; null when they cancel. */
    selectRegion(): Promise<MauzDesktopContext | null>;
    setLensExpanded(payload: MauzLensResizeRequest): Promise<void>;
    /** The popover was hidden (closed, Escape, or lost focus); stop audio and microphone use. */
    onHidden(callback: () => void): () => void;
  };
  ask: {
    submit(payload: AskMauzRequest): Promise<AskMauzResponse>;
    onDelta(callback: (payload: AskAnswerDelta) => void): () => void;
  };
  providers: {
    status(payload?: AiProvidersStatusRequest): Promise<AiProvidersStatusResponse>;
    connect(payload: SubscriptionConnectRequest): Promise<SubscriptionConnectState>;
    submitCode(payload: SubscriptionCodeRequest): Promise<void>;
    cancelConnect(payload: SubscriptionCancelRequest): Promise<void>;
    disconnect(payload: SubscriptionDisconnectRequest): Promise<AiProvidersStatusResponse>;
    openConnectPage(payload: SubscriptionCancelRequest): Promise<void>;
    onConnectState(callback: (state: SubscriptionConnectState) => void): () => void;
  };
  talk: {
    transcribe(payload: TalkTranscribeRequest): Promise<TalkTranscribeResponse>;
    captureContext(): Promise<MauzDesktopContext>;
  };
  browser: {
    status(): Promise<BrowserExtensionStatus>;
    openExtensionFolder(): Promise<void>;
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
  task: {
    agents(): Promise<TaskAgentsResponse>;
    folders(payload: TaskFoldersRequest): Promise<TaskFoldersResponse>;
    /** Opens a folder dialog; null when the user cancels. */
    pickFolder(): Promise<string | null>;
    /** Opens the agent in its own terminal window with the task, then returns. */
    send(payload: TaskSendRequest): Promise<TaskSendResponse>;
  };
};
