import { screen } from "electron";
import type {
  Bounds,
  BrowserPage,
  MauzDesktopContext,
  PermissionError,
  Platform,
  PointerContext,
  PointerTarget
} from "@mauzai/shared";
import { ActiveWindowService, type ActiveWindowMetadata } from "./ActiveWindowService";
import { SelectedTextService } from "./SelectedTextService";
import { ScreenshotCaptureError, ScreenshotService, type PointerCaptureFocus } from "./ScreenshotService";
import type { WindowsContextHelper } from "./WindowsContextHelper";

const supportedPlatforms = new Set<NodeJS.Platform>(["darwin", "win32", "linux"]);

type Point = {
  x: number;
  y: number;
};

type CaptureHider = {
  hideDuringCapture<T>(operation: () => Promise<T>): Promise<T>;
};

export type BrowserPageResult = { page: BrowserPage } | { blockedHost: string };

/** Reads the active tab of a browser through the Mauz browser extension. */
export type BrowserPageReader = {
  /**
   * `executable` is the browser's program name (msedge.exe) or bundle id. Undefined when that
   * browser has no connected extension or does not answer in time.
   */
  readPage(executable: string, blockedSites: readonly string[]): Promise<BrowserPageResult | undefined>;
};

type ContextCollectorOptions = {
  screenshotService?: ScreenshotService;
  activeWindowService?: ActiveWindowService;
  selectedTextService?: SelectedTextService;
  captureHider?: CaptureHider;
  windowsContextHelper?: WindowsContextHelper | undefined;
  browserPageReader?: BrowserPageReader | undefined;
  /** Executable names or bundle ids the user never wants captured. */
  getCaptureBlockedApps?: () => readonly string[];
  /** Site patterns (example.com, *bank*) whose pages are never captured. */
  getCaptureBlockedSites?: () => readonly string[];
  ownProcessId?: number;
};

/** What Mauz read from the app and the browser, rather than from pixels. */
type Readings = {
  target?: PointerTarget | undefined;
  page?: BrowserPage | undefined;
  /** A never-capture site open in a browser involved in this capture. Kept on this computer. */
  blockedSite?: string | undefined;
  /** The Windows helper could not say which app is under the pointer. */
  appUnknown?: boolean | undefined;
};

type TargetLookup = {
  target?: PointerTarget | undefined;
  failed: boolean;
};

type ActivationSnapshot = ActiveWindowMetadata & {
  cursor: Point;
  selectedText?: string | undefined;
  readings: Readings;
};

type CollectOptions = {
  useActivationSnapshot?: boolean | undefined;
};

type AskBaseContext = {
  context: MauzDesktopContext;
  readings: Readings;
};

export class ContextCollector {
  private readonly screenshotService: ScreenshotService;
  private readonly activeWindowService: ActiveWindowService;
  private readonly selectedTextService: SelectedTextService;
  private readonly windowsHelper: WindowsContextHelper | undefined;
  private readonly browserPageReader: BrowserPageReader | undefined;
  private readonly captureHider: CaptureHider | undefined;
  private readonly getCaptureBlockedApps: () => readonly string[];
  private readonly getCaptureBlockedSites: () => readonly string[];
  private readonly ownProcessId: number;
  private activationSnapshot: ActivationSnapshot | null = null;

  constructor(options: ContextCollectorOptions = {}) {
    this.screenshotService = options.screenshotService ?? new ScreenshotService();
    this.activeWindowService =
      options.activeWindowService ?? new ActiveWindowService({ windowsHelper: options.windowsContextHelper });
    this.selectedTextService =
      options.selectedTextService ?? new SelectedTextService({ windowsHelper: options.windowsContextHelper });
    this.windowsHelper = options.windowsContextHelper;
    this.browserPageReader = options.browserPageReader;
    this.captureHider = options.captureHider;
    this.getCaptureBlockedApps = options.getCaptureBlockedApps ?? (() => []);
    this.getCaptureBlockedSites = options.getCaptureBlockedSites ?? (() => []);
    this.ownProcessId = options.ownProcessId ?? process.pid;
  }

  collectBasicContext(cursor: Point = screen.getCursorScreenPoint()): MauzDesktopContext {
    return {
      timestamp: new Date().toISOString(),
      platform: this.getPlatform(),
      cursor
    };
  }

  discardActivationSnapshot(): void {
    this.activationSnapshot = null;
  }

  async collectForAsk(options: CollectOptions = {}): Promise<MauzDesktopContext> {
    const { context, readings } = await this.collectAskBaseContext(options);
    const { target, page } = readings;
    const blocked = this.findBlocked(context, readings);

    if (blocked !== undefined) {
      // Nothing from a never-capture app or site leaves this method: no pixels, text, or title.
      return { ...this.collectBasicContext(context.cursor), captureBlocked: { appName: blocked } };
    }

    const focus = getCaptureFocus(target);
    const capture = async () => this.screenshotService.capturePointerContext(context.cursor, focus);

    try {
      const pointer =
        this.captureHider === undefined
          ? await capture()
          : await this.captureHider.hideDuringCapture(capture);

      const pointerContext = mergePointerMetadata(pointer, context, target, page);
      const ocrText = await this.recognizeText(pointerContext);

      if (ocrText !== undefined) {
        pointerContext.ocrText = ocrText;
      }

      return {
        ...context,
        pointer: pointerContext,
        ...(pointerContext.screenshot === undefined ? {} : { screenshot: pointerContext.screenshot })
      };
    } catch (error) {
      const textOnly = mergePointerMetadata({ cursor: context.cursor }, {}, target, page);

      return {
        ...context,
        // Text read from the app is still useful when the screenshot fails.
        ...(target === undefined && page === undefined ? {} : { pointer: textOnly }),
        screenshotError: toScreenshotError(error)
      };
    }
  }

  async prepareForActivation(cursor: Point): Promise<void> {
    const metadata = await this.captureActiveWindowMetadata();
    // The browser answers on its own channel while the Windows helper works.
    const foregroundPage = this.readBrowserPage(metadata.activeApp?.bundleId);
    // Held in memory only; it is sent to a model only if the user picks an action.
    const selectedText = this.selectedTextService.capturesAtActivation
      ? await this.captureSelectedText(metadata)
      : undefined;
    // Read before the popover opens over the pointer.
    const readings = await this.captureReadings(cursor, metadata, foregroundPage);

    this.activationSnapshot = {
      activeApp: metadata.activeApp,
      activeWindow: metadata.activeWindow,
      cursor,
      selectedText,
      readings
    };
  }

  private getPlatform(): Platform {
    if (supportedPlatforms.has(process.platform)) {
      return process.platform as Platform;
    }

    return "linux";
  }

  private async collectAskBaseContext(options: CollectOptions): Promise<AskBaseContext> {
    const useActivationSnapshot = options.useActivationSnapshot ?? true;
    const activationSnapshot = useActivationSnapshot ? this.activationSnapshot : null;

    if (useActivationSnapshot) {
      this.activationSnapshot = null;
    }

    const activeMetadata =
      activationSnapshot === null
        ? await this.captureActiveWindowMetadata()
        : { activeApp: activationSnapshot.activeApp, activeWindow: activationSnapshot.activeWindow };
    const cursor = activationSnapshot?.cursor ?? screen.getCursorScreenPoint();
    const basicContext = this.collectBasicContext(cursor);
    const selectedText = this.selectedTextService.capturesAtActivation
      ? activationSnapshot?.selectedText
      : await this.captureSelectedText(activeMetadata);
    // Without a snapshot (it was discarded or already used), read what is on screen now.
    const readings = activationSnapshot?.readings ?? (await this.captureReadings(cursor, activeMetadata));

    return {
      context: {
        ...basicContext,
        activeApp: activeMetadata.activeApp,
        activeWindow: activeMetadata.activeWindow,
        selectedText: selectedText?.trim() ? selectedText : undefined
      },
      readings
    };
  }

  /**
   * The element under the pointer and, through the browser extension, the page. Every browser
   * involved is asked, so a never-capture site is caught even when that browser is not in front.
   */
  private async captureReadings(
    cursor: Point,
    metadata: ActiveWindowMetadata,
    foregroundPage: Promise<BrowserPageResult | undefined> = this.readBrowserPage(
      metadata.activeApp?.bundleId
    )
  ): Promise<Readings> {
    const foregroundExecutable = metadata.activeApp?.bundleId;
    const lookup = await this.captureTarget(cursor);
    const pointerExecutable = lookup.target?.window?.executable;
    // A browser under the pointer that is not in front is asked too.
    const pointerPage =
      pointerExecutable === undefined || sameApp(pointerExecutable, foregroundExecutable)
        ? undefined
        : this.readBrowserPage(pointerExecutable);
    const [foregroundResult, pointerResult] = await Promise.all([foregroundPage, pointerPage]);
    const blockedSite = getBlockedHost(foregroundResult) ?? getBlockedHost(pointerResult);

    return {
      target: lookup.target,
      page: getPage(pointerPage === undefined ? foregroundResult : pointerResult),
      blockedSite,
      appUnknown: lookup.failed
    };
  }

  private async captureActiveWindowMetadata(): Promise<ActiveWindowMetadata> {
    try {
      const metadata = await this.activeWindowService.capture();

      // While a Mauz window has focus (no activation snapshot), Mauz itself is the frontmost app,
      // which tells the model nothing about what the user is working on.
      return metadata.activeApp?.processId === this.ownProcessId ? {} : metadata;
    } catch {
      return {};
    }
  }

  private async captureSelectedText(metadata: ActiveWindowMetadata): Promise<string | undefined> {
    try {
      return await this.selectedTextService.capture({
        processId: metadata.activeApp?.processId
      });
    } catch {
      return undefined;
    }
  }

  private async captureTarget(point: Point): Promise<TargetLookup> {
    if (this.windowsHelper === undefined) {
      return { failed: false };
    }

    try {
      // Mauz's own windows are looked through to the app behind them.
      const target = await this.windowsHelper.getElementAtPoint(point, {
        excludeProcessId: this.ownProcessId
      });

      return { target: target?.window?.processId === this.ownProcessId ? undefined : target, failed: false };
    } catch {
      return { failed: true };
    }
  }

  private async readBrowserPage(executable: string | undefined): Promise<BrowserPageResult | undefined> {
    if (this.browserPageReader === undefined || executable === undefined) {
      return undefined;
    }

    try {
      return await this.browserPageReader.readPage(executable, this.getCaptureBlockedSites());
    } catch {
      return undefined;
    }
  }

  /** OCR for apps that expose no text. */
  private async recognizeText(pointer: PointerContext): Promise<string | undefined> {
    const crop = pointer.cursorCrop;

    if (this.windowsHelper === undefined || crop === undefined) {
      return undefined;
    }

    if (pointer.page !== undefined || hasAppText(pointer.target)) {
      return undefined;
    }

    try {
      return await this.windowsHelper.recognizeText(crop);
    } catch {
      return undefined;
    }
  }

  /** The never-capture app or site this capture would include, if any. */
  private findBlocked(context: MauzDesktopContext, readings: Readings): string | undefined {
    const blockedApps = new Set(
      this.getCaptureBlockedApps()
        .map((entry) => normalizeAppKey(entry))
        .filter((entry) => entry.length > 0)
    );
    const candidates = [
      { name: context.activeApp?.name, keys: [context.activeApp?.bundleId, context.activeApp?.name] },
      {
        name: readings.target?.window?.appName,
        keys: [readings.target?.window?.executable, readings.target?.window?.appName]
      }
    ];

    for (const candidate of candidates) {
      if (candidate.keys.some((key) => key !== undefined && blockedApps.has(normalizeAppKey(key)))) {
        return candidate.name?.trim() || candidate.keys.find(isDefined) || "a blocked app";
      }
    }

    if (readings.blockedSite !== undefined) {
      return readings.blockedSite;
    }

    // Unable to tell which app is under the pointer, Mauz cannot honour the lists, so it captures nothing.
    const hasLists =
      blockedApps.size > 0 || this.getCaptureBlockedSites().some((site) => site.trim().length > 0);

    return readings.appUnknown === true && hasLists ? "an app Mauz could not identify" : undefined;
  }
}

/** Case-insensitive, and "1Password" matches "1Password.exe". */
function normalizeAppKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, "");
}

function hasAppText(target: PointerTarget | undefined): boolean {
  return (
    target?.element.text !== undefined ||
    target?.element.value !== undefined ||
    target?.container?.text !== undefined
  );
}

function sameApp(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && normalizeAppKey(a) === normalizeAppKey(b);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function getBlockedHost(result: BrowserPageResult | undefined): string | undefined {
  return result !== undefined && "blockedHost" in result ? result.blockedHost : undefined;
}

function getPage(result: BrowserPageResult | undefined): BrowserPage | undefined {
  return result !== undefined && "page" in result ? result.page : undefined;
}

function getCaptureFocus(target: PointerTarget | undefined): PointerCaptureFocus {
  if (target === undefined) {
    return {};
  }

  // The group around the element frames the crop best (the whole card, the whole dialog).
  const targets = [target.container?.bounds, target.element.bounds].filter(
    (bounds): bounds is Bounds => bounds !== undefined
  );

  return {
    targets,
    ...(target.window?.bounds === undefined ? {} : { window: target.window.bounds })
  };
}

function mergePointerMetadata(
  pointer: PointerContext,
  context: Partial<MauzDesktopContext>,
  target: PointerTarget | undefined,
  page: BrowserPage | undefined
): PointerContext {
  // The screenshot pointer has none of these fields, so an undefined value hides nothing.
  return {
    ...pointer,
    activeApp: context.activeApp,
    activeWindow: context.activeWindow,
    selectedText: context.selectedText,
    target,
    page
  };
}

function toScreenshotError(error: unknown): PermissionError {
  if (error instanceof ScreenshotCaptureError) {
    return {
      permission: error.permission,
      message: error.message
    };
  }

  return {
    permission: "unknown",
    message: "Mauz could not capture screenshot context."
  };
}
