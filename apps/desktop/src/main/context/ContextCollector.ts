import { screen } from "electron";
import type { MauzDesktopContext, Platform } from "@mauzai/shared";
import { ScreenshotService } from "./ScreenshotService";

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
    const screenshot =
      this.captureHider === undefined ? await capture() : await this.captureHider.hideDuringCapture(capture);

    return {
      ...context,
      screenshot
    };
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }
}
