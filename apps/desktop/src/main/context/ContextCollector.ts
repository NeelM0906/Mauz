import { screen } from "electron";
import type {
  Bounds,
  MauzDesktopContext,
  PermissionError,
  Platform,
  PointerContext,
  PointerTarget
} from "@mauzai/shared";
import { ActiveWindowService, type ActiveWindowMetadata } from "./ActiveWindowService";
import { SelectedTextService } from "./SelectedTextService";
import { ScreenshotCaptureError, ScreenshotService, type PointerCaptureFocus } from "./ScreenshotService";
import type { WindowsContextHelper } from "./WindowsContextHelper";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

type Point = {
  x: number;
  y: number;
};

type CaptureHider = {
  hideDuringCapture<T>(operation: () => Promise<T>): Promise<T>;
};

type PointerTargetReader = Pick<WindowsContextHelper, "getElementAtPoint">;

type ContextCollectorOptions = {
  screenshotService?: ScreenshotService;
  activeWindowService?: ActiveWindowService;
  selectedTextService?: SelectedTextService;
  captureHider?: CaptureHider;
  windowsContextHelper?: WindowsContextHelper | undefined;
  /** Executable names or bundle ids the user never wants captured. */
  getCaptureBlockedApps?: () => readonly string[];
  ownProcessId?: number;
};

type ActivationSnapshot = ActiveWindowMetadata & {
  cursor: Point;
  selectedText?: string | undefined;
  target?: PointerTarget | undefined;
};

type CollectPointerContextOptions = {
  useActivationSnapshot?: boolean | undefined;
  useActivationCursor?: boolean | undefined;
};

type AskBaseContext = {
  context: MauzDesktopContext;
  target: PointerTarget | undefined;
};

export class ContextCollector {
  private readonly screenshotService: ScreenshotService;
  private readonly activeWindowService: ActiveWindowService;
  private readonly selectedTextService: SelectedTextService;
  private readonly targetReader: PointerTargetReader | undefined;
  private readonly captureHider: CaptureHider | undefined;
  private readonly getCaptureBlockedApps: () => readonly string[];
  private readonly ownProcessId: number;
  private activationSnapshot: ActivationSnapshot | null = null;

  constructor(options: ContextCollectorOptions = {}) {
    this.screenshotService = options.screenshotService ?? new ScreenshotService();
    this.activeWindowService =
      options.activeWindowService ?? new ActiveWindowService({ windowsHelper: options.windowsContextHelper });
    this.selectedTextService =
      options.selectedTextService ?? new SelectedTextService({ windowsHelper: options.windowsContextHelper });
    this.targetReader = options.windowsContextHelper;
    this.captureHider = options.captureHider;
    this.getCaptureBlockedApps = options.getCaptureBlockedApps ?? (() => []);
    this.ownProcessId = options.ownProcessId ?? process.pid;
  }

  collectBasicContext(cursor: Point = screen.getCursorScreenPoint()): MauzDesktopContext {
    return {
      timestamp: new Date().toISOString(),
      platform: this.getPlatform(),
      cursor
    };
  }

  async collectForAsk(options: CollectPointerContextOptions = {}): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext(options);
  }

  async collectForRealtime(): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext({
      useActivationCursor: false
    });
  }

  discardActivationSnapshot(): void {
    this.activationSnapshot = null;
  }

  private async collectWithPointerContext(
    options: CollectPointerContextOptions = {}
  ): Promise<MauzDesktopContext> {
    const { context, target } = await this.collectAskBaseContext(options);
    const blockedApp = this.findBlockedApp(context, target);

    if (blockedApp !== undefined) {
      // Nothing from a never-capture app leaves this method: no pixels, text, or window title.
      return { ...this.collectBasicContext(context.cursor), captureBlocked: { appName: blockedApp } };
    }

    const focus = getCaptureFocus(target);
    const capture = async () => this.screenshotService.capturePointerContext(context.cursor, focus);

    try {
      const pointer =
        this.captureHider === undefined
          ? await capture()
          : await this.captureHider.hideDuringCapture(capture);

      const pointerContext = mergePointerMetadata(pointer, context, target);

      return {
        ...context,
        pointer: pointerContext,
        ...(pointerContext.screenshot === undefined ? {} : { screenshot: pointerContext.screenshot })
      };
    } catch (error) {
      return {
        ...context,
        // Text read from the app is still useful when the screenshot fails.
        ...(target === undefined ? {} : { pointer: { cursor: context.cursor, target } }),
        screenshotError: toScreenshotError(error)
      };
    }
  }

  async prepareForActivation(cursor: Point): Promise<void> {
    const metadata = await this.captureActiveWindowMetadata();
    // Held in memory only; it is sent to a model only if the user picks an action.
    const selectedText = this.selectedTextService.capturesAtActivation
      ? await this.captureSelectedText(metadata)
      : undefined;
    // Read before the popover opens over the pointer.
    const target = await this.captureTarget(cursor);

    this.activationSnapshot = withOptionalActivationFields({
      ...metadata,
      cursor,
      selectedText,
      target
    });
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }

  private async collectAskBaseContext(options: CollectPointerContextOptions): Promise<AskBaseContext> {
    const useActivationSnapshot = options.useActivationSnapshot ?? true;
    const activationSnapshot = useActivationSnapshot ? this.activationSnapshot : null;

    if (useActivationSnapshot) {
      this.activationSnapshot = null;
    }

    const activeMetadata =
      activationSnapshot === null
        ? await this.captureActiveWindowMetadata()
        : getActivationMetadata(activationSnapshot);
    const cursor =
      activationSnapshot !== null && options.useActivationCursor !== false
        ? activationSnapshot.cursor
        : screen.getCursorScreenPoint();
    const basicContext = this.collectBasicContext(cursor);
    const selectedText = this.selectedTextService.capturesAtActivation
      ? activationSnapshot?.selectedText
      : await this.captureSelectedText(activeMetadata);
    // Later Talk turns have no snapshot; read what is under the pointer now.
    const target = activationSnapshot === null ? await this.captureTarget(cursor) : activationSnapshot.target;

    return {
      context: withOptionalContextFields({
        ...basicContext,
        ...activeMetadata,
        selectedText
      }),
      target
    };
  }

  private async captureActiveWindowMetadata(): Promise<ActiveWindowMetadata> {
    try {
      const metadata = await this.activeWindowService.capture();

      // While a Mauz window has focus (later voice turns), Mauz itself is the frontmost app,
      // which tells the model nothing about what the user is working on.
      return metadata.activeApp?.processId === this.ownProcessId ? {} : metadata;
    } catch {
      return {};
    }
  }

  private async captureSelectedText(metadata: ActiveWindowMetadata): Promise<string | undefined> {
    try {
      return await this.selectedTextService.capture({
        processId: metadata.activeApp?.processId
      });
    } catch {
      return undefined;
    }
  }

  private async captureTarget(cursor: Point): Promise<PointerTarget | undefined> {
    if (this.targetReader === undefined) {
      return undefined;
    }

    try {
      const target = await this.targetReader.getElementAtPoint(cursor);

      // The pointer is over a Mauz window (the popover or Settings), not the user's work.
      return target?.window?.processId === this.ownProcessId ? undefined : target;
    } catch {
      return undefined;
    }
  }

  private findBlockedApp(context: MauzDesktopContext, target: PointerTarget | undefined): string | undefined {
    const blocked = new Set(
      this.getCaptureBlockedApps()
        .map((entry) => normalizeAppKey(entry))
        .filter((entry) => entry.length > 0)
    );

    if (blocked.size === 0) {
      return undefined;
    }

    const candidates = [
      { name: context.activeApp?.name, keys: [context.activeApp?.bundleId, context.activeApp?.name] },
      { name: target?.window?.appName, keys: [target?.window?.executable, target?.window?.appName] }
    ];

    for (const candidate of candidates) {
      if (candidate.keys.some((key) => key !== undefined && blocked.has(normalizeAppKey(key)))) {
        return candidate.name?.trim() || candidate.keys.find((key) => key !== undefined) || "a blocked app";
      }
    }

    return undefined;
  }
}

/** Case-insensitive, and "1Password" matches "1Password.exe". */
function normalizeAppKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function getCaptureFocus(target: PointerTarget | undefined): PointerCaptureFocus {
  if (target === undefined) {
    return {};
  }

  // The group around the element frames the crop best (the whole card, the whole dialog).
  const targets = [target.container?.bounds, target.element.bounds].filter(
    (bounds): bounds is Bounds => bounds !== undefined
  );

  return {
    targets,
    ...(target.window?.bounds === undefined ? {} : { window: target.window.bounds })
  };
}

function mergePointerMetadata(
  pointer: PointerContext,
  context: MauzDesktopContext,
  target: PointerTarget | undefined
): PointerContext {
  const pointerContext: PointerContext = {
    ...pointer
  };

  if (context.activeApp !== undefined) {
    pointerContext.activeApp = context.activeApp;
  }

  if (context.activeWindow !== undefined) {
    pointerContext.activeWindow = context.activeWindow;
  }

  if (context.selectedText !== undefined) {
    pointerContext.selectedText = context.selectedText;
  }

  if (target !== undefined) {
    pointerContext.target = target;
  }

  return pointerContext;
}

function getActivationMetadata(snapshot: ActivationSnapshot): ActiveWindowMetadata {
  const metadata: ActiveWindowMetadata = {};

  if (snapshot.activeApp !== undefined) {
    metadata.activeApp = snapshot.activeApp;
  }

  if (snapshot.activeWindow !== undefined) {
    metadata.activeWindow = snapshot.activeWindow;
  }

  return metadata;
}

function withOptionalContextFields(context: MauzDesktopContext): MauzDesktopContext {
  const nextContext: MauzDesktopContext = {
    timestamp: context.timestamp,
    platform: context.platform,
    cursor: context.cursor
  };

  if (context.activeApp !== undefined) {
    nextContext.activeApp = context.activeApp;
  }

  if (context.activeWindow !== undefined) {
    nextContext.activeWindow = context.activeWindow;
  }

  if (context.selectedText?.trim()) {
    nextContext.selectedText = context.selectedText;
  }

  return nextContext;
}

function withOptionalActivationFields(snapshot: ActivationSnapshot): ActivationSnapshot {
  const nextSnapshot: ActivationSnapshot = {
    cursor: snapshot.cursor
  };

  if (snapshot.activeApp !== undefined) {
    nextSnapshot.activeApp = snapshot.activeApp;
  }

  if (snapshot.activeWindow !== undefined) {
    nextSnapshot.activeWindow = snapshot.activeWindow;
  }

  if (snapshot.selectedText?.trim()) {
    nextSnapshot.selectedText = snapshot.selectedText;
  }

  if (snapshot.target !== undefined) {
    nextSnapshot.target = snapshot.target;
  }

  return nextSnapshot;
}

function toScreenshotError(error: unknown): PermissionError {
  if (error instanceof ScreenshotCaptureError) {
    return {
      permission: error.permission,
      message: error.message
    };
  }

  return {
    permission: "unknown",
    message: "Mauz could not capture screenshot context."
  };
}
