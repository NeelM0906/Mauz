import type {
  AskMauzRequest,
  AskMauzResponse,
  MauzDesktopContext,
  MauzBridge,
  Platform,
  MauzSettings,
  MauzSettingsUpdate,
  PermissionError,
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
    startScreenShare: async () => collectPreviewContext()
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
  realtime: {
    createSession: async () => {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
  },
  settings: {
    open: async () => ({
      nativeShakeEnabled: false,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal"
    }),
    update: async (payload: MauzSettingsUpdate) => ({
      nativeShakeEnabled: payload.nativeShakeEnabled ?? false,
      devHotkeyEnabled: payload.devHotkeyEnabled ?? true,
      shakeSensitivity: payload.shakeSensitivity ?? "normal"
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
  createRealtimeSession(): Promise<RealtimeSessionResponse> {
    return getBridge().realtime.createSession();
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
