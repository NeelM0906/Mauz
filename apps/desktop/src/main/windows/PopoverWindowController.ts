import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import {
  IPC_CHANNELS,
  MAUZ_ASK_PANEL_SIZE,
  MAUZ_POPUP_SIZE,
  MAUZ_REALTIME_PANEL_SIZE,
  MAUZ_SETTINGS_PANEL_SIZE
} from "@mauzai/shared";
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
const TARGET_CUE_SIZE = 92;
const TARGET_CUE_DURATION_MS = 500;

export class PopoverWindowController {
  private window: BrowserWindow | null = null;
  private targetCueWindow: BrowserWindow | null = null;
  private targetCueTimer: NodeJS.Timeout | null = null;
  private targetCueRequestId = 0;
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
      void this.showTargetCue(point).catch(() => {});
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

  resizeForSettings(): void {
    this.setSize(MAUZ_SETTINGS_PANEL_SIZE);
    this.repositionAtLastAnchor();
  }

  resizeForRealtime(): void {
    this.setSize(MAUZ_REALTIME_PANEL_SIZE);
    this.repositionAtLastAnchor();
  }

  hide(): void {
    if (this.window?.isDestroyed() === false && this.window.isVisible()) {
      this.window.hide();
    }

    this.hideTargetCue();
  }

  async hideDuringCapture<T>(operation: () => Promise<T>): Promise<T> {
    const win = this.requireWindow();
    const wasVisible = win.isVisible();
    const anchorPoint = this.lastAnchorPoint ?? screen.getCursorScreenPoint();

    this.hideTargetCue();

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
    this.clearTargetCueTimer();

    if (this.window?.isDestroyed() === false) {
      this.window.destroy();
    }

    if (this.targetCueWindow?.isDestroyed() === false) {
      this.targetCueWindow.destroy();
    }

    this.window = null;
    this.targetCueWindow = null;
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

  private async showTargetCue(point: Point): Promise<void> {
    const requestId = ++this.targetCueRequestId;
    const cue = await this.getTargetCueWindow();

    if (cue.isDestroyed() || requestId !== this.targetCueRequestId) {
      return;
    }

    this.clearTargetCueTimer();
    cue.setPosition(
      Math.round(point.x - TARGET_CUE_SIZE / 2),
      Math.round(point.y - TARGET_CUE_SIZE / 2),
      false
    );
    cue.showInactive();

    this.targetCueTimer = setTimeout(() => {
      this.hideTargetCue();
    }, TARGET_CUE_DURATION_MS);
  }

  private async getTargetCueWindow(): Promise<BrowserWindow> {
    if (this.targetCueWindow?.isDestroyed() === false) {
      return this.targetCueWindow;
    }

    const cue = new BrowserWindow({
      width: TARGET_CUE_SIZE,
      height: TARGET_CUE_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    cue.setAlwaysOnTop(true, "screen-saver");
    cue.setIgnoreMouseEvents(true, { forward: true });
    cue.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.targetCueWindow = cue;
    await cue.loadURL(getTargetCueDataUrl());

    return cue;
  }

  private hideTargetCue(): void {
    this.targetCueRequestId += 1;
    this.clearTargetCueTimer();

    if (this.targetCueWindow?.isDestroyed() === false && this.targetCueWindow.isVisible()) {
      this.targetCueWindow.hide();
    }
  }

  private clearTargetCueTimer(): void {
    if (this.targetCueTimer !== null) {
      clearTimeout(this.targetCueTimer);
      this.targetCueTimer = null;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getTargetCueDataUrl(): string {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: transparent;
      }

      body {
        display: grid;
        place-items: center;
      }

      .target-ring {
        width: 58px;
        height: 58px;
        border: 2px solid rgb(22 122 107 / 72%);
        border-radius: 999px;
        box-shadow:
          0 0 0 8px rgb(22 122 107 / 12%),
          0 0 22px rgb(22 122 107 / 28%);
        animation: mauz-target-cue 500ms ease-out forwards;
      }

      @keyframes mauz-target-cue {
        from {
          transform: scale(0.78);
          opacity: 0;
        }

        18% {
          opacity: 1;
        }

        to {
          transform: scale(1.18);
          opacity: 0;
        }
      }
    </style>
  </head>
  <body>
    <div class="target-ring"></div>
  </body>
</html>`;

  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
