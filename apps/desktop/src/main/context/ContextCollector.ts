import { screen } from "electron";
import type { MauzDesktopContext, Platform } from "@mauzai/shared";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

export class ContextCollector {
  collectBasicContext(): MauzDesktopContext {
    const cursor = screen.getCursorScreenPoint();

    return {
      timestamp: new Date().toISOString(),
      platform: this.getPlatform(),
      cursor
    };
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }
}
