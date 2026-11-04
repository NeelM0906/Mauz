import { BrowserWindow } from "electron";
import type { Bounds } from "@mauzai/shared";

type DisplayLike = {
  bounds: Bounds;
};

type RegionSelectorOptions = {
  iconPath: string;
  excludeFromCapture: boolean;
};

// Long enough for a careful selection; a forgotten overlay should not block the screen forever.
const SELECTION_TIMEOUT_MS = 60_000;
// Lets the compositor remove the overlay before the screen is captured.
const OVERLAY_TEARDOWN_DELAY_MS = 80;
const MIN_REGION_SIZE = 8;

/**
 * A dimmed, full-display overlay where the user drags a rectangle. The page is a self-contained
 * data URL with no preload or IPC; the result is read back with executeJavaScript.
 */
export class RegionSelector {
  constructor(private readonly options: RegionSelectorOptions) {}

  /** The selected area in screen DIPs, or null when the user cancels. */
  async select(display: DisplayLike): Promise<Bounds | null> {
    const win = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      icon: this.options.iconPath,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.setAlwaysOnTop(true, "screen-saver");

    if (this.options.excludeFromCapture) {
      win.setContentProtection(true);
    }

    let cancelTimer: NodeJS.Timeout | undefined;

    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(OVERLAY_HTML)}`);
      win.setBounds(display.bounds);
      win.show();
      win.focus();

      const selection = await Promise.race([
        win.webContents.executeJavaScript("window.mauzSelection", true) as Promise<unknown>,
        // Switching to another window or closing the overlay cancels.
        new Promise<null>((resolve) => {
          win.once("blur", () => resolve(null));
          win.once("closed", () => resolve(null));
          cancelTimer = setTimeout(() => resolve(null), SELECTION_TIMEOUT_MS);
        })
      ]);

      return toScreenBounds(selection, display.bounds);
    } finally {
      clearTimeout(cancelTimer);

      if (!win.isDestroyed()) {
        win.destroy();
      }

      await delay(OVERLAY_TEARDOWN_DELAY_MS);
    }
  }
}

/** The page reports a rectangle relative to the overlay, which covers the display. */
export function toScreenBounds(selection: unknown, displayBounds: Bounds): Bounds | null {
  if (typeof selection !== "object" || selection === null) {
    return null;
  }

  const { x, y, width, height } = selection as Record<string, unknown>;

  if (![x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value))) {
    return null;
  }

  const left = Math.max(0, x as number);
  const top = Math.max(0, y as number);
  const right = Math.min(displayBounds.width, (x as number) + (width as number));
  const bottom = Math.min(displayBounds.height, (y as number) + (height as number));

  if (right - left < MIN_REGION_SIZE || bottom - top < MIN_REGION_SIZE) {
    return null;
  }

  return {
    x: displayBounds.x + left,
    y: displayBounds.y + top,
    width: right - left,
    height: bottom - top
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; cursor: crosshair; user-select: none; }
  body { background: rgba(10, 12, 16, 0.28); font-family: system-ui, sans-serif; }
  body.dragging { background: transparent; }
  #box { position: fixed; display: none; border: 2px solid #4f8cff; border-radius: 3px;
    box-shadow: 0 0 0 100000px rgba(10, 12, 16, 0.28); }
  #hint { position: fixed; top: 28px; left: 50%; transform: translateX(-50%); padding: 8px 14px;
    border-radius: 8px; background: rgba(20, 22, 26, 0.88); color: #fff; font-size: 13px; pointer-events: none; }
</style>
</head>
<body>
<div id="hint">Drag to select an area. Press Esc to cancel.</div>
<div id="box"></div>
<script>
  window.mauzSelection = new Promise(function (resolve) {
    var start = null;
    var box = document.getElementById("box");
    var hint = document.getElementById("hint");
    function rectFrom(event) {
      return {
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y)
      };
    }
    addEventListener("keydown", function (event) { if (event.key === "Escape") resolve(null); });
    addEventListener("contextmenu", function (event) { event.preventDefault(); resolve(null); });
    addEventListener("mousedown", function (event) {
      if (event.button !== 0) { resolve(null); return; }
      start = { x: event.clientX, y: event.clientY };
      document.body.classList.add("dragging");
      hint.style.display = "none";
    });
    addEventListener("mousemove", function (event) {
      if (start === null) return;
      var r = rectFrom(event);
      box.style.display = "block";
      box.style.left = r.x + "px";
      box.style.top = r.y + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
    });
    addEventListener("mouseup", function (event) {
      if (start !== null) resolve(rectFrom(event));
    });
  });
</script>
</body>
</html>`;
