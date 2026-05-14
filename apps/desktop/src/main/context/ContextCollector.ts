import { screen } from "electron";
import type { MauzDesktopContext, PermissionError, Platform } from "@mauzai/shared";
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
    const capture = async () => this.screenshotService.captureDisplayNear(context.cursor);

    try {
      const screenshot =
        this.captureHider === undefined
          ? await capture()
          : await this.captureHider.hideDuringCapture(capture);

      return {
        ...context,
        screenshot
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
