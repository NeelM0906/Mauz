import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PointerContext, PointerTarget } from "@mauzai/shared";

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
import type { WindowsContextHelper } from "../src/main/context/WindowsContextHelper";

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

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(
      {
        x: 320,
        y: 240
      },
      {}
    );
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

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(activationCursor, {});
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

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(currentCursor, {});
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

  it("reads the pointed element at activation and frames the crop on it", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const helper = createTargetReader(productTarget);
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: helper
    });

    await collector.prepareForActivation({ x: 110, y: 220 });
    screenMock.getCursorScreenPoint.mockReturnValue({ x: 900, y: 700 });
    const context = await collector.collectForAsk();

    expect(helper.getElementAtPoint).toHaveBeenCalledTimes(1);
    expect(helper.getElementAtPoint).toHaveBeenCalledWith(
      { x: 110, y: 220 },
      { excludeProcessId: expect.any(Number) }
    );
    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith(
      { x: 110, y: 220 },
      {
        targets: [productTarget.container!.bounds, productTarget.element.bounds],
        window: productTarget.window!.bounds
      }
    );
    expect(context.pointer?.target).toEqual(productTarget);
  });

  it("drops a pointed element that belongs to Mauz itself", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader({ ...productTarget, window: { processId: 777 } }),
      ownProcessId: 777
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).toHaveBeenCalledWith({ x: 320, y: 240 }, {});
    expect(context.pointer?.target).toBeUndefined();
  });

  it("keeps the pointed element text when the screenshot fails", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => {
        throw new ScreenshotCaptureError("no capture");
      })
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader(productTarget)
    });

    const context = await collector.collectForAsk();

    expect(context.pointer).toEqual({ cursor: { x: 320, y: 240 }, target: productTarget });
    expect(context.screenshotError?.message).toBe("no capture");
  });

  it.each([
    [
      "the foreground app",
      { activeApp: { name: "Signal", bundleId: "Signal.exe", processId: 9 } },
      undefined
    ],
    [
      "the window under the pointer",
      { activeApp: { name: "Code", bundleId: "Code.exe", processId: 8 } },
      { ...productTarget, window: { appName: "Slack", executable: "slack.exe", processId: 10 } }
    ]
  ])("captures nothing when %s is on the never-capture list", async (_label, metadata, target) => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService(metadata),
      selectedTextService: createSelectedTextService("private note"),
      windowsContextHelper: createTargetReader(target),
      // Matching is case-insensitive and ignores ".exe".
      getCaptureBlockedApps: () => ["signal", "Slack.exe"]
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).not.toHaveBeenCalled();
    expect(context).toEqual({
      timestamp: expect.any(String),
      platform: expect.any(String),
      cursor: { x: 320, y: 240 },
      captureBlocked: { appName: target === undefined ? "Signal" : "Slack" }
    });
  });
});

describe("ContextCollector: OCR and browser pages", () => {
  beforeEach(() => {
    screenMock.getCursorScreenPoint.mockReturnValue({ x: 320, y: 240 });
  });

  it("uses OCR only when the app exposes no text", async () => {
    const recognizeText = vi.fn(async () => "terminal output");
    const collect = async (target: PointerTarget) => {
      const collector = new ContextCollector({
        screenshotService: {
          capturePointerContext: vi.fn(async () => pointerContext)
        } as unknown as ScreenshotService,
        activeWindowService: createActiveWindowService(),
        selectedTextService: createSelectedTextService(),
        windowsContextHelper: {
          getElementAtPoint: vi.fn(async () => target),
          recognizeText
        } as unknown as WindowsContextHelper
      });

      return collector.collectForAsk();
    };

    const withoutText = await collect({ source: "windows-uia", element: { role: "Pane", name: "Terminal" } });
    const withText = await collect(productTarget);

    expect(withoutText.pointer?.ocrText).toBe("terminal output");
    expect(withText.pointer?.ocrText).toBeUndefined();
    expect(recognizeText).toHaveBeenCalledTimes(1);
  });

  it("reads the browser page at activation and keeps it for the pointed browser", async () => {
    const browserPageReader = {
      readPage: vi.fn(async () => ({
        page: { browser: "Microsoft Edge", url: "https://shop.example.com/p/1", title: "Shop" }
      }))
    };
    const collector = new ContextCollector({
      screenshotService: {
        capturePointerContext: vi.fn(async () => pointerContext)
      } as unknown as ScreenshotService,
      activeWindowService: createActiveWindowService({
        activeApp: { name: "Microsoft Edge", bundleId: "msedge.exe", processId: 31 }
      }),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader(productTarget),
      browserPageReader,
      getCaptureBlockedSites: () => ["*bank*"]
    });

    await collector.prepareForActivation({ x: 110, y: 220 });
    const context = await collector.collectForAsk();

    expect(browserPageReader.readPage).toHaveBeenCalledWith("msedge.exe", ["*bank*"]);
    expect(context.pointer?.page?.url).toBe("https://shop.example.com/p/1");
  });

  it("reads the page from the browser under the pointer, not the one in front", async () => {
    const readPage = vi.fn(async (executable: string) =>
      executable === "msedge.exe"
        ? { page: { browser: "Microsoft Edge", url: "https://shop.example.com/p/1" } }
        : { page: { browser: "Google Chrome", url: "https://news.example.com" } }
    );
    const collector = new ContextCollector({
      screenshotService: {
        capturePointerContext: vi.fn(async () => pointerContext)
      } as unknown as ScreenshotService,
      activeWindowService: createActiveWindowService({
        activeApp: { name: "Google Chrome", bundleId: "chrome.exe", processId: 40 }
      }),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader(productTarget),
      browserPageReader: { readPage }
    });

    const context = await collector.collectForAsk();

    expect(readPage).toHaveBeenCalledWith("chrome.exe", []);
    expect(readPage).toHaveBeenCalledWith("msedge.exe", []);
    expect(context.pointer?.page?.url).toBe("https://shop.example.com/p/1");
  });

  it("blocks a never-capture site in a background browser under the pointer", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      // Mauz itself is in front during later Dictate turns.
      activeWindowService: createActiveWindowService(),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader(productTarget),
      browserPageReader: {
        readPage: vi.fn(async (executable: string) =>
          executable === "msedge.exe" ? { blockedHost: "online.examplebank.com" } : undefined
        )
      },
      getCaptureBlockedSites: () => ["*bank*"]
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).not.toHaveBeenCalled();
    expect(context.captureBlocked).toEqual({ appName: "online.examplebank.com" });
  });

  it("blocks when the foreground browser shows a never-capture site", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService({
        activeApp: { name: "Google Chrome", bundleId: "chrome.exe", processId: 40 }
      }),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader({
        source: "windows-uia",
        element: { role: "Pane" },
        window: { appName: "Code", executable: "Code.exe", processId: 8 }
      }),
      browserPageReader: {
        readPage: vi.fn(async (executable: string) =>
          executable === "chrome.exe" ? { blockedHost: "www.paypal.com" } : undefined
        )
      }
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).not.toHaveBeenCalled();
    expect(context.captureBlocked).toEqual({ appName: "www.paypal.com" });
  });

  it("captures nothing when the app under the pointer cannot be identified and lists are set", async () => {
    const collect = async (blockedApps: string[]) => {
      const screenshotService = {
        capturePointerContext: vi.fn(async () => pointerContext)
      } as unknown as ScreenshotService;
      const collector = new ContextCollector({
        screenshotService,
        activeWindowService: createActiveWindowService(),
        selectedTextService: createSelectedTextService(),
        windowsContextHelper: {
          getElementAtPoint: vi.fn(async () => {
            throw new Error("Windows context helper timed out on elementAtPoint.");
          })
        } as unknown as WindowsContextHelper,
        getCaptureBlockedApps: () => blockedApps
      });

      return { context: await collector.collectForAsk(), screenshotService };
    };

    const withList = await collect(["Signal.exe"]);
    const withoutList = await collect([]);

    expect(withList.context.captureBlocked).toEqual({ appName: "an app Mauz could not identify" });
    expect(withList.screenshotService.capturePointerContext).not.toHaveBeenCalled();
    expect(withoutList.context.captureBlocked).toBeUndefined();
    expect(withoutList.context.pointer).toBeDefined();
  });

  it("captures nothing from a never-capture site", async () => {
    const screenshotService = {
      capturePointerContext: vi.fn(async () => pointerContext)
    } as unknown as ScreenshotService;
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: createActiveWindowService({
        activeApp: { name: "Microsoft Edge", bundleId: "msedge.exe", processId: 31 }
      }),
      selectedTextService: createSelectedTextService(),
      windowsContextHelper: createTargetReader(productTarget),
      browserPageReader: { readPage: vi.fn(async () => ({ blockedHost: "online.examplebank.com" })) }
    });

    const context = await collector.collectForAsk();

    expect(screenshotService.capturePointerContext).not.toHaveBeenCalled();
    expect(context.captureBlocked).toEqual({ appName: "online.examplebank.com" });
    expect(context.pointer).toBeUndefined();
  });
});

const productTarget: PointerTarget = {
  source: "windows-uia",
  element: { role: "Text", name: "$328.00", bounds: { x: 100, y: 200, width: 60, height: 20 } },
  container: {
    role: "ListItem",
    text: "Sony WH-1000XM5\n$328.00",
    bounds: { x: 80, y: 150, width: 300, height: 260 }
  },
  window: {
    title: "Shop",
    appName: "Microsoft Edge",
    executable: "msedge.exe",
    processId: 31,
    bounds: { x: 0, y: 0, width: 1440, height: 900 }
  }
};

function createTargetReader(target: PointerTarget | undefined): WindowsContextHelper {
  return {
    getElementAtPoint: vi.fn(async () => target)
  } as unknown as WindowsContextHelper;
}

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
