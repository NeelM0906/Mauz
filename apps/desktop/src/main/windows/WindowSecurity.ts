import type { BrowserWindow } from "electron";

type TrustedRendererOptions = {
  rendererUrl?: string | undefined;
};

export function hardenRendererWindow(win: BrowserWindow, options: TrustedRendererOptions = {}): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (isTrustedRendererUrl(url, options.rendererUrl)) {
      return;
    }

    event.preventDefault();
  });
}

export function isTrustedRendererUrl(rawUrl: string, rendererUrl?: string | undefined): boolean {
  try {
    const url = new URL(rawUrl);

    if (url.protocol === "file:") {
      return true;
    }

    if (rendererUrl === undefined) {
      return false;
    }

    const trusted = new URL(rendererUrl);

    return (
      url.protocol === trusted.protocol && url.hostname === trusted.hostname && url.port === trusted.port
    );
  } catch {
    return false;
  }
}
