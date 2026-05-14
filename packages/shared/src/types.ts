export type Platform = "darwin" | "win32" | "linux";

export type ScreenshotPayload = {
  mimeType: "image/jpeg" | "image/png";
  base64: string;
  width: number;
  height: number;
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
  screenshot?: ScreenshotPayload | undefined;
};

export type AskMauzRequest = {
  question: string;
  context: MauzDesktopContext;
};

export type AskMauzResponse = {
  answer: string;
  model: string;
  usage?: unknown | undefined;
};

export type RealtimeSessionResponse = {
  value: string;
  expires_at?: number | undefined;
  session?: unknown | undefined;
};

export type PermissionError = {
  permission: "accessibility" | "screen-recording" | "microphone" | "unknown";
  message: string;
};

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
  realtime: {
    createSession(): Promise<RealtimeSessionResponse>;
  };
  events: {
    onActivation(callback: () => void): () => void;
    onPermissionError(callback: (error: PermissionError) => void): () => void;
  };
};
