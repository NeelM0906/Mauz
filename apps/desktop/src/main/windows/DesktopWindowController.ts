import { BrowserWindow } from "electron";
import { join } from "node:path";

type DesktopWindowControllerOptions = {
  preloadPath: string;
  iconPath: string;
  rendererUrl?: string;
  rendererFile: string;
};

const DESKTOP_WINDOW_SIZE = {
  width: 1040,
  height: 720,
  minWidth: 860,
  minHeight: 580
} as const;

export class DesktopWindowController {
  private window: BrowserWindow | null = null;
  private readonly options: DesktopWindowControllerOptions;

  constructor(options: DesktopWindowControllerOptions) {
    this.options = options;
  }

  async create(): Promise<void> {
    if (this.window?.isDestroyed() === false) {
      return;
    }

    const win = new BrowserWindow({
      width: DESKTOP_WINDOW_SIZE.width,
      height: DESKTOP_WINDOW_SIZE.height,
      minWidth: DESKTOP_WINDOW_SIZE.minWidth,
      minHeight: DESKTOP_WINDOW_SIZE.minHeight,
      show: false,
      title: "MauzAI",
      icon: this.options.iconPath,
      autoHideMenuBar: true,
      backgroundColor: "#f4f5f1",
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    win.on("close", (event) => {
      if (win.isDestroyed()) {
        return;
      }

      event.preventDefault();
      win.hide();
    });

    this.window = win;

    if (this.options.rendererUrl !== undefined) {
      await win.loadURL(withRendererSurface(this.options.rendererUrl, "desktop"));
    } else {
      await win.loadFile(join(this.options.rendererFile), {
        query: {
          surface: "desktop"
        }
      });
    }
  }

  async show(): Promise<void> {
    await this.create();

    const win = this.requireWindow();
    win.show();
    win.focus();
  }

  destroy(): void {
    if (this.window?.isDestroyed() === false) {
      this.window.removeAllListeners("close");
      this.window.destroy();
    }

    this.window = null;
  }

  private requireWindow(): BrowserWindow {
    if (this.window === null || this.window.isDestroyed()) {
      throw new Error("Desktop window has not been created.");
    }

    return this.window;
  }
}

function withRendererSurface(rendererUrl: string, surface: "desktop"): string {
  const url = new URL(rendererUrl);
  url.searchParams.set("surface", surface);

  return url.toString();
}
