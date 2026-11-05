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
  /** Other app windows the capture covers (a selected area's corners). */
  otherWindows?: Array<PointerTarget["window"]> | undefined;
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

type CollectPointerContextOptions = {
  useActivationSnapshot?: boolean | undefined;
  useActivationCursor?: boolean | undefined;
};

type CollectOptions = CollectPointerContextOptions & {
  /** A screen area the user selected; replaces the pointer as what "this" means. */
  region?: Bounds | undefined;
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

  async collectForAsk(options: CollectPointerContextOptions = {}): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext(options);
  }

  async collectForRealtime(): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext({
      useActivationCursor: false
    });
  }

  /** Context for a screen area the user dragged out (DIPs). */
  async collectForRegion(region: Bounds): Promise<MauzDesktopContext> {
    return this.collectWithPointerContext({ useActivationSnapshot: false, region });
  }

  discardActivationSnapshot(): void {
    this.activationSnapshot = null;
  }

  private async collectWithPointerContext(options: CollectOptions = {}): Promise<MauzDesktopContext> {
    const { context, readings } = await this.collectAskBaseContext(options);
    const { target, page } = readings;
    const blocked = this.findBlocked(context, readings);

    if (blocked !== undefined) {
      // Nothing from a never-capture app or site leaves this method: no pixels, text, or title.
      return { ...this.collectBasicContext(context.cursor), captureBlocked: { appName: blocked } };
    }

    const focus: PointerCaptureFocus = {
      ...getCaptureFocus(target),
      ...(options.region === undefined ? {} : { region: options.region })
    };
    const capture = async () => this.screenshotService.capturePointerContext(context.cursor, focus);

    try {
      const pointer =
        this.captureHider === undefined
          ? await capture()
          : await this.captureHider.hideDuringCapture(capture);

      const pointerContext = mergePointerMetadata(pointer, context, target, page);
      const ocrText = await this.recognizeText(pointerContext, options.region !== undefined);

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
    const readings = await this.captureReadings(cursor, metadata, { includePage: true, foregroundPage });

    this.activationSnapshot = withOptionalActivationFields({
      ...metadata,
      cursor,
      selectedText,
      readings
    });
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
        : getActivationMetadata(activationSnapshot);
    const cursor =
      options.region !== undefined
        ? getCenter(options.region)
        : activationSnapshot !== null && options.useActivationCursor !== false
          ? activationSnapshot.cursor
          : screen.getCursorScreenPoint();
    const basicContext = this.collectBasicContext(cursor);
    const selectedText = this.selectedTextService.capturesAtActivation
      ? activationSnapshot?.selectedText
      : await this.captureSelectedText(activeMetadata);
    // Later Talk turns and selected areas have no snapshot; read what is on screen now.
    const readings =
      activationSnapshot === null
        ? await this.captureReadings(cursor, activeMetadata, {
            includePage: options.region === undefined,
            extraPoints: options.region === undefined ? [] : getCorners(options.region)
          })
        : activationSnapshot.readings;

    return {
      context: withOptionalContextFields({
        ...basicContext,
        ...activeMetadata,
        selectedText
      }),
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
    options: {
      includePage: boolean;
      extraPoints?: readonly Point[];
      foregroundPage?: Promise<BrowserPageResult | undefined> | undefined;
    }
  ): Promise<Readings> {
    const foregroundExecutable = metadata.activeApp?.bundleId;
    const foregroundPage = options.foregroundPage ?? this.readBrowserPage(foregroundExecutable);
    const lookup = await this.captureTarget(cursor);
    const extraLookups: TargetLookup[] = [];

    for (const point of options.extraPoints ?? []) {
      extraLookups.push(await this.captureTarget(point));
    }

    const pointerExecutable = lookup.target?.window?.executable;
    const otherExecutables = [
      pointerExecutable,
      ...extraLookups.map((extra) => extra.target?.window?.executable)
    ].filter(
      (executable, index, all): executable is string =>
        executable !== undefined &&
        !sameApp(executable, foregroundExecutable) &&
        all.findIndex((other) => other !== undefined && sameApp(other, executable)) === index
    );
    const [foregroundResult, ...otherResults] = await Promise.all([
      foregroundPage,
      ...otherExecutables.map((executable) => this.readBrowserPage(executable))
    ]);
    const results = [foregroundResult, ...otherResults];
    const blockedSite = results.map((result) => getBlockedHost(result)).find(isDefined);
    const pointerResult =
      pointerExecutable === undefined || sameApp(pointerExecutable, foregroundExecutable)
        ? foregroundResult
        : otherResults[otherExecutables.findIndex((executable) => sameApp(executable, pointerExecutable))];

    return {
      target: lookup.target,
      page: options.includePage ? getPage(pointerResult) : undefined,
      otherWindows: extraLookups.map((extra) => extra.target?.window).filter(isDefined),
      blockedSite,
      appUnknown: lookup.failed || extraLookups.some((extra) => extra.failed)
    };
  }

  private async captureActiveWindowMetadata(): Promise<ActiveWindowMetadata> {
    try {
      const metadata = await this.activeWindowService.capture();

      // While a Mauz window has focus (later voice turns), Mauz itself is the frontmost app,
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

  /** OCR for apps that expose no text, and always for a selected area. */
  private async recognizeText(pointer: PointerContext, isRegion: boolean): Promise<string | undefined> {
    const crop = pointer.cursorCrop;

    if (this.windowsHelper === undefined || crop === undefined) {
      return undefined;
    }

    if (!isRegion && (pointer.page !== undefined || hasAppText(pointer.target))) {
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
      ...[readings.target?.window, ...(readings.otherWindows ?? [])].map((window) => ({
        name: window?.appName,
        keys: [window?.executable, window?.appName]
      }))
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

/** Points just inside a selected area's corners, to find every app it covers. */
function getCorners(bounds: Bounds): Point[] {
  const inset = Math.min(4, bounds.width / 4, bounds.height / 4);
  const left = bounds.x + inset;
  const top = bounds.y + inset;
  const right = bounds.x + bounds.width - inset;
  const bottom = bounds.y + bounds.height - inset;

  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: left, y: bottom },
    { x: right, y: bottom }
  ];
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

function getCenter(bounds: Bounds): Point {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
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
  const pointerContext: PointerContext = {
    ...pointer
  };

  if (context.activeApp !== undefined) {
    pointerContext.activeApp = context.activeApp;
  }

  if (context.activeWindow !== undefined) {
    pointerContext.activeWindow = context.activeWindow;
  }

  if (context.selectedText !== undefined) {
    pointerContext.selectedText = context.selectedText;
  }

  if (target !== undefined) {
    pointerContext.target = target;
  }

  if (page !== undefined) {
    pointerContext.page = page;
  }

  return pointerContext;
}

function getActivationMetadata(snapshot: ActivationSnapshot): ActiveWindowMetadata {
  const metadata: ActiveWindowMetadata = {};

  if (snapshot.activeApp !== undefined) {
    metadata.activeApp = snapshot.activeApp;
  }

  if (snapshot.activeWindow !== undefined) {
    metadata.activeWindow = snapshot.activeWindow;
  }

  return metadata;
}

function withOptionalContextFields(context: MauzDesktopContext): MauzDesktopContext {
  const nextContext: MauzDesktopContext = {
    timestamp: context.timestamp,
    platform: context.platform,
    cursor: context.cursor
  };

  if (context.activeApp !== undefined) {
    nextContext.activeApp = context.activeApp;
  }

  if (context.activeWindow !== undefined) {
    nextContext.activeWindow = context.activeWindow;
  }

  if (context.selectedText?.trim()) {
    nextContext.selectedText = context.selectedText;
  }

  return nextContext;
}

function withOptionalActivationFields(snapshot: ActivationSnapshot): ActivationSnapshot {
  const nextSnapshot: ActivationSnapshot = {
    cursor: snapshot.cursor,
    readings: snapshot.readings
  };

  if (snapshot.activeApp !== undefined) {
    nextSnapshot.activeApp = snapshot.activeApp;
  }

  if (snapshot.activeWindow !== undefined) {
    nextSnapshot.activeWindow = snapshot.activeWindow;
  }

  if (snapshot.selectedText?.trim()) {
    nextSnapshot.selectedText = snapshot.selectedText;
  }

  return nextSnapshot;
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
