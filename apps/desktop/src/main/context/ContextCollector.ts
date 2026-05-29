import { screen } from "electron";
import type { MauzDesktopContext, PermissionError, Platform, PointerContext } from "@mauzai/shared";
import { ActiveWindowService, type ActiveWindowMetadata } from "./ActiveWindowService";
import { SelectedTextService } from "./SelectedTextService";
import { ScreenshotCaptureError, ScreenshotService } from "./ScreenshotService";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

type Point = {
  x: number;
  y: number;
};

type CaptureHider = {
  hideDuringCapture<T>(operation: () => Promise<T>): Promise<T>;
};

type ContextCollectorOptions = {
  screenshotService?: ScreenshotService;
  activeWindowService?: ActiveWindowService;
  selectedTextService?: SelectedTextService;
  captureHider?: CaptureHider;
};

type ActivationSnapshot = ActiveWindowMetadata & {
  cursor: Point;
};

type CollectPointerContextOptions = {
  useActivationSnapshot?: boolean | undefined;
  useActivationCursor?: boolean | undefined;
};

export class ContextCollector {
  private readonly screenshotService: ScreenshotService;
  private readonly activeWindowService: ActiveWindowService;
  private readonly selectedTextService: SelectedTextService;
  private readonly captureHider: CaptureHider | undefined;
  private activationSnapshot: ActivationSnapshot | null = null;

  constructor(options: ContextCollectorOptions = {}) {
    this.screenshotService = options.screenshotService ?? new ScreenshotService();
    this.activeWindowService = options.activeWindowService ?? new ActiveWindowService();
    this.selectedTextService = options.selectedTextService ?? new SelectedTextService();
    this.captureHider = options.captureHider;
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
    const context = await this.collectAskBaseContext(options);
    const capture = async () => this.screenshotService.capturePointerContext(context.cursor);

    try {
      const pointer =
        this.captureHider === undefined
          ? await capture()
          : await this.captureHider.hideDuringCapture(capture);

      const pointerContext = mergePointerMetadata(pointer, context);

      return {
        ...context,
        pointer: pointerContext,
        screenshot: pointerContext.screenshot
      };
    } catch (error) {
      return {
        ...context,
        screenshotError: toScreenshotError(error)
      };
    }
  }

  async prepareForActivation(cursor: Point): Promise<void> {
    const metadata = await this.captureActiveWindowMetadata();

    this.activationSnapshot = withOptionalActivationFields({
      ...metadata,
      cursor
    });
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }

  private async collectAskBaseContext(options: CollectPointerContextOptions): Promise<MauzDesktopContext> {
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
    const selectedText = await this.captureSelectedText(activeMetadata);

    return withOptionalContextFields({
      ...basicContext,
      ...activeMetadata,
      selectedText
    });
  }

  private async captureActiveWindowMetadata(): Promise<ActiveWindowMetadata> {
    try {
      return await this.activeWindowService.capture();
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
}

function mergePointerMetadata(pointer: PointerContext, context: MauzDesktopContext): PointerContext {
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
