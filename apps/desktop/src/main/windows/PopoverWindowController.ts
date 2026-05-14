import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { IPC_CHANNELS, MAUZ_ASK_PANEL_SIZE, MAUZ_POPUP_SIZE } from "@mauzai/shared";
import { getClampedPopoverPosition, type Point, type Size } from "./PopoverPosition";

type PopoverWindowControllerOptions = {
  preloadPath: string;
  rendererUrl?: string;
  rendererFile: string;
};

type ShowOptions = {
  notifyActivation?: boolean;
  preserveSize?: boolean;
};

const SCREEN_MARGIN = 8;
const CURSOR_OFFSET = 12;
const SCREENSHOT_HIDE_DELAY_MS = 120;

export class PopoverWindowController {
  private window: BrowserWindow | null = null;
  private readonly options: PopoverWindowControllerOptions;
  private lastAnchorPoint: Point | null = null;
  private currentSize: Size = { ...MAUZ_POPUP_SIZE };

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

  async showAt(point: Point, options: ShowOptions = {}): Promise<void> {
    await this.create();

    const win = this.requireWindow();
    this.lastAnchorPoint = point;

    if (options.preserveSize !== true) {
      this.resizeForMenu();
    }

    const position = this.getClampedPosition(point);

    win.setPosition(position.x, position.y, false);
    win.show();
    win.focus();

    if (options.notifyActivation ?? true) {
      win.webContents.send(IPC_CHANNELS.activation);
    }
  }

  async showAtLastAnchor(options: ShowOptions = {}): Promise<void> {
    await this.showAt(this.lastAnchorPoint ?? screen.getCursorScreenPoint(), options);
  }

  resizeForMenu(): void {
    this.setSize(MAUZ_POPUP_SIZE);
    this.repositionAtLastAnchor();
  }

  resizeForAsk(): void {
    this.setSize(MAUZ_ASK_PANEL_SIZE);
    this.repositionAtLastAnchor();
  }

  hide(): void {
    if (this.window?.isDestroyed() === false && this.window.isVisible()) {
      this.window.hide();
    }
  }

  async hideDuringCapture<T>(operation: () => Promise<T>): Promise<T> {
    const win = this.requireWindow();
    const wasVisible = win.isVisible();
    const anchorPoint = this.lastAnchorPoint ?? screen.getCursorScreenPoint();

    if (wasVisible) {
      win.hide();
      await delay(SCREENSHOT_HIDE_DELAY_MS);
    }

    try {
      return await operation();
    } finally {
      if (wasVisible) {
        await this.showAt(anchorPoint, {
          notifyActivation: false,
          preserveSize: true
        });
      }
    }
  }

  destroy(): void {
    if (this.window?.isDestroyed() === false) {
      this.window.destroy();
    }

    this.window = null;
  }

  private getClampedPosition(point: Point, size: Size = this.currentSize): Point {
    const display = screen.getDisplayNearestPoint(point);

    return getClampedPopoverPosition(point, display.workArea, size, {
      cursorOffset: CURSOR_OFFSET,
      screenMargin: SCREEN_MARGIN
    });
  }

  private requireWindow(): BrowserWindow {
    if (this.window === null || this.window.isDestroyed()) {
      throw new Error("Popover window has not been created.");
    }

    return this.window;
  }

  private setSize(size: { width: number; height: number }): void {
    this.currentSize = { ...size };

    if (this.window?.isDestroyed() === false) {
      this.window.setSize(size.width, size.height, false);
    }
  }

  private repositionAtLastAnchor(): void {
    if (this.window?.isDestroyed() !== false || this.lastAnchorPoint === null) {
      return;
    }

    const position = this.getClampedPosition(this.lastAnchorPoint);
    this.window.setPosition(position.x, position.y, false);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
