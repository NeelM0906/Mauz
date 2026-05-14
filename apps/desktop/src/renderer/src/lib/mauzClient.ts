import type {
  AskMauzRequest,
  AskMauzResponse,
  MauzDesktopContext,
  MauzBridge,
  Platform,
  PermissionError,
  RealtimeSessionResponse
} from "@mauzai/shared";

type WindowWithOptionalBridge = Window & {
  mauz?: MauzBridge;
};

const browserPreviewBridge: MauzBridge = {
  menu: {
    close: async () => {},
    startAsk: async () => collectPreviewContext(),
    startTalk: async () => collectPreviewContext(),
    startScreenShare: async () => collectPreviewContext()
  },
  ask: {
    submit: async (_payload: AskMauzRequest) => {
      throw new Error("Ask Mauz API is not implemented in this milestone.");
    }
  },
  realtime: {
    createSession: async () => {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
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
  createRealtimeSession(): Promise<RealtimeSessionResponse> {
    return getBridge().realtime.createSession();
  },
  onActivation(callback: () => void): () => void {
    return getBridge().events.onActivation(callback);
  },
  onPermissionError(callback: (error: PermissionError) => void): () => void {
    return getBridge().events.onPermissionError(callback);
  }
};
