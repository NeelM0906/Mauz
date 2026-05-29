import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerContext } from "@mauzai/shared";

const screenMock = vi.hoisted(() => ({
  getCursorScreenPoint: vi.fn()
}));

vi.mock("electron", () => ({
  screen: screenMock
}));

import { ContextCollector } from "../src/main/context/ContextCollector";
import type { ActiveWindowService } from "../src/main/context/ActiveWindowService";
import type { SelectedTextService } from "../src/main/context/SelectedTextService";
import { ScreenshotCaptureError, type ScreenshotService } from "../src/main/context/ScreenshotService";

const pointerContext: PointerContext = {
  cursor: {
    x: 320,
    y: 240
  },
  display: {
    id: "1",
    bounds: {
      x: 0,
      y: 0,
      width: 1440,
      height: 900
    },
    scaleFactor: 2
  },
  cursorCrop: {
    mimeType: "image/jpeg",
    base64: "cursor-crop",
    width: 768,
    height: 576
  },
  screenshot: {
    mimeType: "image/jpeg",
    base64: "full-screenshot",
    width: 1280,
    height: 800
  }
};

describe("ContextCollector", () => {
  beforeEach(() => {
    screenMock.getCursorScreenPoint.mockReturnValue({
      x: 320,
      y: 240
    });
  });

  it("attaches pointer context and keeps screenshot compatibility for Ask", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    let hideDuringCaptureCalls = 0;
    const captureHider = {
      async hideDuringCapture<T>(operation: () => Promise<T>): Promise<T> {
        hideDuringCaptureCalls += 1;
        return operation();
      }
    };
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService(),
      captureHider
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith({
      x: 320,
      y: 240
    });
    expect(hideDuringCaptureCalls).toBe(1);
    expect(context.pointer).toEqual(pointerContext);
    expect(context.screenshot).toEqual(pointerContext.screenshot);
  });

  it("captures pointer context at the activation cursor even after the current cursor moves", async () => {
    const activationCursor = {
      x: 110,
      y: 220
    };
    const activationPointerContext: PointerContext = {
      ...pointerContext,
      cursor: activationCursor
    };
    const screenshotService = {
      capturePointerContext: vi.fn(async () => activationPointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService()
    });

    await collector.prepareForActivation(activationCursor);
    screenMock.getCursorScreenPoint.mockReturnValue({
      x: 900,
      y: 700
    });
    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(activationCursor);
    expect(context.cursor).toEqual(activationCursor);
    expect(context.pointer?.cursor).toEqual(activationCursor);
  });

  it("can collect from the current cursor when activation context should be ignored", async () => {
    const currentCursor = {
      x: 900,
      y: 700
    };
    const currentPointerContext: PointerContext = {
      ...pointerContext,
      cursor: currentCursor
    };
    const screenshotService = {
      capturePointerContext: vi.fn(async () => currentPointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService()
    });

    await collector.prepareForActivation({
      x: 110,
      y: 220
    });
    screenMock.getCursorScreenPoint.mockReturnValue(currentCursor);
    const context = await collector.collectForAsk({
      useActivationSnapshot: false
    });

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(currentCursor);
    expect(context.cursor).toEqual(currentCursor);
    expect(context.pointer?.cursor).toEqual(currentCursor);
  });

  it("returns basic context with screenshotError when pointer capture fails", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => {
        throw new ScreenshotCaptureError(
          "Mauz needs Screen Recording permission to capture screenshot context."
        );
      })
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService()
    });

    const context = await collector.collectForAsk();

    expect(context.pointer).toBeUndefined();
    expect(context.screenshot).toBeUndefined();
    expect(context.screenshotError).toEqual({
      permission: "screen-recording",
      message: "Mauz needs Screen Recording permission to capture screenshot context."
    });
  });

  it("keeps Ask working when active app metadata capture fails", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: {
        capture: vi.fn(async () => {
          throw new Error("Accessibility unavailable");
        })
      } as unknown as ActiveWindowService,
      selectedTextService: createSelectedTextService()
    });

    const context = await collector.collectForAsk();

    expect(context.activeApp).toBeUndefined();
    expect(context.activeWindow).toBeUndefined();
    expect(context.pointer).toEqual(pointerContext);
  });

  it("includes selected text in desktop and pointer context when available", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const activeWindowService = createActiveWindowService({
      activeApp: {
        name: "Code",
        bundleId: "com.microsoft.VSCode",
        processId: 4242
      },
      activeWindow: {
        title: "MauzAI",
        bounds: {
          x: 10,
          y: 20,
          width: 900,
          height: 700
        }
      }
    });
    const selectedTextService = {
      capture: vi.fn(async () => "selected error text")
    } as unknown as SelectedTextService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService,
      selectedTextService
    });

    const context = await collector.collectForAsk();

    expect(selectedTextService.capture).toHaveBeenCalledWith({
      processId: 4242
    });
    expect(context.selectedText).toBe("selected error text");
    expect(context.pointer?.selectedText).toBe("selected error text");
    expect(context.pointer?.activeWindow?.title).toBe("MauzAI");
  });

  it("captures selected text after Ask starts using activation app metadata", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const activeWindowService = createActiveWindowService({
      activeApp: {
        name: "Safari",
        processId: 2026
      },
      activeWindow: {
        title: "Docs"
      }
    });
    const selectedTextService = {
      capture: vi.fn(async () => "activation selected text")
    } as unknown as SelectedTextService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService,
      selectedTextService
    });

    await collector.prepareForActivation({
      x: 320,
      y: 240
    });
    expect(selectedTextService.capture).not.toHaveBeenCalled();
    const context = await collector.collectForAsk();

    expect(activeWindowService.capture).toHaveBeenCalledTimes(1);
    expect(selectedTextService.capture).toHaveBeenCalledTimes(1);
    expect(selectedTextService.capture).toHaveBeenCalledWith({
      processId: 2026
    });
    expect(context.selectedText).toBe("activation selected text");
    expect(context.pointer?.selectedText).toBe("activation selected text");
  });
});

function createActiveWindowService(
  metadata: Awaited<ReturnType<ActiveWindowService["capture"]>> = {}
): ActiveWindowService {
  return {
    capture: vi.fn(async () => metadata)
  } as unknown as ActiveWindowService;
}

function createSelectedTextService(selectedText?: string): SelectedTextService {
  return {
    capture: vi.fn(async () => selectedText)
  } as unknown as SelectedTextService;
}
