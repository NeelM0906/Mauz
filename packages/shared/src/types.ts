import type { z } from "zod";
import type {
  AiProviderIdSchema,
  AiProviderPreferenceSchema,
  AiProvidersStatusRequestSchema,
  AiProvidersStatusResponseSchema,
  AiProviderStatusSchema,
  AskAnswerDeltaSchema,
  AskMauzRequestSchema,
  AskMauzResponseSchema,
  BoundsSchema,
  BrowserPageSchema,
  BrowserProductSchema,
  CaptureBlockedSchema,
  CursorCropFocusSchema,
  MauzDesktopContextSchema,
  MauzSettingsSchema,
  MauzSettingsUpdateSchema,
  MouseMoveSampleSchema,
  OpenAiCredentialSourceSchema,
  PermissionErrorSchema,
  PlatformSchema,
  PointerContextSchema,
  PointerTargetElementSchema,
  PointerTargetSchema,
  ScreenshotPayloadSchema,
  ShakeSensitivitySchema,
  SubscriptionCancelRequestSchema,
  SubscriptionCodeRequestSchema,
  SubscriptionConnectRequestSchema,
  SubscriptionConnectStateSchema,
  SubscriptionDisconnectRequestSchema,
  SubscriptionProviderIdSchema,
  DictateTranscribeRequestSchema,
  DictateTranscribeResponseSchema,
  TaskAgentIdSchema,
  TaskAgentPreferenceSchema,
  TaskAgentsResponseSchema,
  TaskAgentStatusSchema,
  TaskFolderSchema,
  TaskFoldersRequestSchema,
  TaskFoldersResponseSchema,
  TaskSendRequestSchema
} from "./schemas";

export type Platform = z.infer<typeof PlatformSchema>;
export type ScreenshotPayload = z.infer<typeof ScreenshotPayloadSchema>;
export type Bounds = z.infer<typeof BoundsSchema>;
export type PointerTargetElement = z.infer<typeof PointerTargetElementSchema>;
export type PointerTarget = z.infer<typeof PointerTargetSchema>;
export type PointerTargetSource = PointerTarget["source"];
export type CursorCropFocus = z.infer<typeof CursorCropFocusSchema>;
export type CaptureBlocked = z.infer<typeof CaptureBlockedSchema>;
export type BrowserProduct = z.infer<typeof BrowserProductSchema>;
export type BrowserPage = z.infer<typeof BrowserPageSchema>;
export type PointerContext = z.infer<typeof PointerContextSchema>;
export type MauzDesktopContext = z.infer<typeof MauzDesktopContextSchema>;

export type AskMauzRequest = z.infer<typeof AskMauzRequestSchema>;
export type AskAnswerDelta = z.infer<typeof AskAnswerDeltaSchema>;
export type AskMauzResponse = z.infer<typeof AskMauzResponseSchema>;

export type AiProviderId = z.infer<typeof AiProviderIdSchema>;
export type AiProviderPreference = z.infer<typeof AiProviderPreferenceSchema>;
export type AiProviderStatus = z.infer<typeof AiProviderStatusSchema>;
export type AiProvidersStatusResponse = z.infer<typeof AiProvidersStatusResponseSchema>;
export type AiProvidersStatusRequest = NonNullable<z.infer<typeof AiProvidersStatusRequestSchema>>;

export type SubscriptionProviderId = z.infer<typeof SubscriptionProviderIdSchema>;
export type SubscriptionConnectState = z.infer<typeof SubscriptionConnectStateSchema>;
export type SubscriptionConnectPhase = SubscriptionConnectState["phase"];
export type SubscriptionConnectRequest = z.infer<typeof SubscriptionConnectRequestSchema>;
export type SubscriptionCodeRequest = z.infer<typeof SubscriptionCodeRequestSchema>;
export type SubscriptionCancelRequest = z.infer<typeof SubscriptionCancelRequestSchema>;
export type SubscriptionDisconnectRequest = z.infer<typeof SubscriptionDisconnectRequestSchema>;

export type DictateTranscribeRequest = z.infer<typeof DictateTranscribeRequestSchema>;
export type DictateTranscribeResponse = z.infer<typeof DictateTranscribeResponseSchema>;

export type PermissionError = z.infer<typeof PermissionErrorSchema>;
export type ShakeSensitivity = z.infer<typeof ShakeSensitivitySchema>;
export type OpenAiCredentialSource = z.infer<typeof OpenAiCredentialSourceSchema>;
export type MauzSettings = z.infer<typeof MauzSettingsSchema>;
export type MauzSettingsUpdate = z.infer<typeof MauzSettingsUpdateSchema>;
export type MouseMoveSample = z.infer<typeof MouseMoveSampleSchema>;

export type TaskAgentId = z.infer<typeof TaskAgentIdSchema>;
export type TaskAgentPreference = z.infer<typeof TaskAgentPreferenceSchema>;
export type TaskAgentStatus = z.infer<typeof TaskAgentStatusSchema>;
export type TaskAgentsResponse = z.infer<typeof TaskAgentsResponseSchema>;
export type TaskFolder = z.infer<typeof TaskFolderSchema>;
export type TaskFoldersRequest = z.infer<typeof TaskFoldersRequestSchema>;
export type TaskFoldersResponse = z.infer<typeof TaskFoldersResponseSchema>;
export type TaskSendRequest = z.infer<typeof TaskSendRequestSchema>;

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
    /** Grows the popover from the menu to the panel size. */
    expand(): Promise<void>;
    /** The popover was hidden (closed, Escape, or lost focus); stop microphone use. */
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
  dictate: {
    transcribe(payload: DictateTranscribeRequest): Promise<DictateTranscribeResponse>;
  };
  browser: {
    status(): Promise<BrowserExtensionStatus>;
    openExtensionFolder(): Promise<void>;
  };
  settings: {
    open(): Promise<MauzSettings>;
    update(payload: MauzSettingsUpdate): Promise<MauzSettings>;
  };
  events: {
    onActivation(callback: () => void): () => void;
    onPermissionError(callback: (error: PermissionError) => void): () => void;
    /** The tray or a second launch asked to show Settings. */
    onOpenSettings(callback: () => void): () => void;
  };
  task: {
    agents(): Promise<TaskAgentsResponse>;
    folders(payload: TaskFoldersRequest): Promise<TaskFoldersResponse>;
    /** Opens a folder dialog; null when the user cancels. */
    pickFolder(): Promise<string | null>;
    /**
     * Starts the task as a background thread in the agent's desktop app (Windows), or opens
     * the agent in its own terminal window, then returns.
     */
    send(payload: TaskSendRequest): Promise<void>;
  };
};
