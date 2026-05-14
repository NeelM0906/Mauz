import { screen } from "electron";
import type { MauzDesktopContext, PermissionError, Platform, PointerContext } from "@mauzai/shared";
import { ScreenshotCaptureError, ScreenshotService } from "./ScreenshotService";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

type CaptureHider = {
  hideDuringCapture<T>(operation: () => Promise<T>): Promise<T>;
};

type ContextCollectorOptions = {
  screenshotService?: ScreenshotService;
  captureHider?: CaptureHider;
};

export class ContextCollector {
  private readonly screenshotService: ScreenshotService;
  private readonly captureHider: CaptureHider | undefined;

  constructor(options: ContextCollectorOptions = {}) {
    this.screenshotService = options.screenshotService ?? new ScreenshotService();
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
    const context = this.collectBasicContext();
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

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
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
