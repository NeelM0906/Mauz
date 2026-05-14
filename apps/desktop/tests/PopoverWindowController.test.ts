import { describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => {
  class FakeBrowserWindow {
    static instances: FakeBrowserWindow[] = [];

    readonly webContents = {
      on: vi.fn(),
      send: vi.fn()
    };
    private visible = false;
    private destroyed = false;

    constructor() {
      FakeBrowserWindow.instances.push(this);
    }

    setAlwaysOnTop = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    setIgnoreMouseEvents = vi.fn();
    setPosition = vi.fn();
    setSize = vi.fn();
    focus = vi.fn();
    on = vi.fn();
    loadURL = vi.fn(async () => {});
    loadFile = vi.fn(async () => {});

    show(): void {
      this.visible = true;
    }

    showInactive(): void {
      this.visible = true;
    }

    hide(): void {
      this.visible = false;
    }

    destroy(): void {
      this.destroyed = true;
      this.visible = false;
    }

    isVisible(): boolean {
      return this.visible;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }
  }

  return {
    FakeBrowserWindow
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.FakeBrowserWindow,
  screen: {
    getCursorScreenPoint: () => ({
      x: 100,
      y: 100
    }),
    getDisplayNearestPoint: () => ({
      workArea: {
        x: 0,
        y: 0,
        width: 1200,
        height: 900
      }
    })
  }
}));

import { PopoverWindowController } from "../src/main/windows/PopoverWindowController";

describe("PopoverWindowController", () => {
  it("hides the target cue before screenshot capture", async () => {
    const controller = new PopoverWindowController({
      preloadPath: "/tmp/preload.js",
      rendererFile: "/tmp/index.html"
    });

    await controller.showAt({
      x: 200,
      y: 220
    });
    await Promise.resolve();
    await Promise.resolve();

    const cueWindow = electronMock.FakeBrowserWindow.instances[1];
    expect(cueWindow?.isVisible()).toBe(true);

    await controller.hideDuringCapture(async () => {
      expect(cueWindow?.isVisible()).toBe(false);
      return undefined;
    });
  });
});
