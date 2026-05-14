import { screen } from "electron";
import type { MauzDesktopContext, PermissionError, Platform, PointerContext } from "@mauzai/shared";
import { ActiveWindowService, type ActiveWindowMetadata } from "./ActiveWindowService";
import { SelectedTextService } from "./SelectedTextService";
import { ScreenshotCaptureError, ScreenshotService } from "./ScreenshotService";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

type CaptureHider = {
  hideDuringCapture<T>(operation: () => Promise<T>): Promise<T>;
};

type ContextCollectorOptions = {
  screenshotService?: ScreenshotService;
  activeWindowService?: ActiveWindowService;
  selectedTextService?: SelectedTextService;
  captureHider?: CaptureHider;
};

export class ContextCollector {
  private readonly screenshotService: ScreenshotService;
  private readonly activeWindowService: ActiveWindowService;
  private readonly selectedTextService: SelectedTextService;
  private readonly captureHider: CaptureHider | undefined;
  private activationMetadata: ActiveWindowMetadata | null = null;

  constructor(options: ContextCollectorOptions = {}) {
    this.screenshotService = options.screenshotService ?? new ScreenshotService();
    this.activeWindowService = options.activeWindowService ?? new ActiveWindowService();
    this.selectedTextService = options.selectedTextService ?? new SelectedTextService();
    this.captureHider = options.captureHider;
  }

  collectBasicContext(): MauzDesktopContext {
    const cursor = screen.getCursorScreenPoint();

    return {
      timestamp: new Date().toISOString(),
      platform: this.getPlatform(),
      cursor
    };
  }

  async collectForAsk(): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext();
  }

  async collectForRealtime(): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext();
  }

  async collectRealtimeFrame(): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext();
  }

  private async collectWithPointerContext(): Promise<MauzDesktopContext> {
    const context = await this.collectAskBaseContext();
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

  async prepareForActivation(): Promise<void> {
    this.activationMetadata = await this.captureActiveWindowMetadata();
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }

  private async collectAskBaseContext(): Promise<MauzDesktopContext> {
    const basicContext = this.collectBasicContext();
    const activeMetadata = this.activationMetadata ?? (await this.captureActiveWindowMetadata());
    this.activationMetadata = null;
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
