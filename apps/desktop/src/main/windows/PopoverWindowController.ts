import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS, MAUZ_POPUP_SIZE } from "@mauzai/shared";

type Point = {
  x: number;
  y: number;
};

type PopoverWindowControllerOptions = {
  preloadPath: string;
  rendererUrl?: string;
  rendererFile: string;
};

const SCREEN_MARGIN = 8;
const CURSOR_OFFSET = 12;

export class PopoverWindowController {
  private window: BrowserWindow | null = null;
  private readonly options: PopoverWindowControllerOptions;

  constructor(options: PopoverWindowControllerOptions) {
    this.options = options;
  }

  async create(): Promise<void> {
    if (this.window !== null) {
      return;
    }

    const win = new BrowserWindow({
      width: MAUZ_POPUP_SIZE.width,
      height: MAUZ_POPUP_SIZE.height,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: true,
      roundedCorners: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    win.setAlwaysOnTop(true, "pop-up-menu");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    win.on("blur", () => {
      this.hide();
    });

    win.webContents.on("before-input-event", (event, input) => {
      if (input.type === "keyDown" && input.key === "Escape") {
        event.preventDefault();
        this.hide();
      }
    });

    this.window = win;

    if (this.options.rendererUrl !== undefined) {
      await win.loadURL(this.options.rendererUrl);
    } else {
      await win.loadFile(join(this.options.rendererFile));
    }
  }

  async showAt(point: Point): Promise<void> {
    await this.create();

    const win = this.requireWindow();
    const position = this.getClampedPosition(point);

    win.setPosition(position.x, position.y, false);
    win.show();
    win.focus();
    win.webContents.send(IPC_CHANNELS.activation);
  }

  hide(): void {
    if (this.window?.isDestroyed() === false && this.window.isVisible()) {
      this.window.hide();
    }
  }

  destroy(): void {
    if (this.window?.isDestroyed() === false) {
      this.window.destroy();
    }

    this.window = null;
  }

  private getClampedPosition(point: Point): Point {
    const display = screen.getDisplayNearestPoint(point);
    const workArea = display.workArea;
    const proposedX = point.x + CURSOR_OFFSET + MAUZ_POPUP_SIZE.width > workArea.x + workArea.width
      ? point.x - CURSOR_OFFSET - MAUZ_POPUP_SIZE.width
      : point.x + CURSOR_OFFSET;
    const proposedY = point.y + CURSOR_OFFSET + MAUZ_POPUP_SIZE.height > workArea.y + workArea.height
      ? point.y - CURSOR_OFFSET - MAUZ_POPUP_SIZE.height
      : point.y + CURSOR_OFFSET;

    return {
      x: clamp(proposedX, workArea.x + SCREEN_MARGIN, workArea.x + workArea.width - MAUZ_POPUP_SIZE.width - SCREEN_MARGIN),
      y: clamp(proposedY, workArea.y + SCREEN_MARGIN, workArea.y + workArea.height - MAUZ_POPUP_SIZE.height - SCREEN_MARGIN)
    };
  }

  private requireWindow(): BrowserWindow {
    if (this.window === null || this.window.isDestroyed()) {
      throw new Error("Popover window has not been created.");
    }

    return this.window;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
