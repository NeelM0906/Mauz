import { app, BrowserWindow, dialog, screen, shell } from "electron";
import { existsSync } from "node:fs";
import { userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IPC_CHANNELS,
  readBooleanEnv,
  type MauzSettings,
  type MauzSettingsUpdate,
  type PermissionError,
  type SubscriptionConnectState
} from "@mauzai/shared";
import {
  createSubscriptionConnector,
  disposeAnswerProviders,
  getAiProvidersStatus,
  hasOpenAiTranscription,
  loadLocalEnv,
  prewarmAnswerProvider,
  transcribeWithOpenAi,
  type SubscriptionConnector
} from "@mauzai/api/server";
import { TaskAgentLauncher } from "./agent/TaskAgentLauncher";
import {
  BrowserBridge,
  getBrowserPipePath,
  loadOrCreateBrowserToken,
  registerNativeHost
} from "./context/BrowserBridge";
import { ContextCollector } from "./context/ContextCollector";
import { WindowsContextHelper } from "./context/WindowsContextHelper";
import { CursorPollingInputProvider } from "./input/CursorPollingInputProvider";
import { DevHotkeyInputProvider } from "./input/DevHotkeyInputProvider";
import type { InputProvider, InputProviderCallbacks } from "./input/InputProvider";
import { MacInputAgentProvider } from "./input/MacInputAgentProvider";
import { getShakeDetectorConfigForSensitivity, ShakeDetector } from "./input/ShakeDetector";
import { TalkTranscriber } from "./talk/TalkTranscriber";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { SettingsService, type MauzRuntimeSettings } from "./settings/SettingsService";
import { PopoverWindowController } from "./windows/PopoverWindowController";
import { TrayController } from "./windows/TrayController";

const __dirname = dirname(fileURLToPath(import.meta.url));

let popover: PopoverWindowController | null = null;
let contextCollector: ContextCollector | null = null;
let settingsService: SettingsService | null = null;
let windowsContextHelper: WindowsContextHelper | null = null;
let browserBridge: BrowserBridge | null = null;
let browserHostRegistered = false;
let subscriptionConnector: SubscriptionConnector | null = null;
let trayController: TrayController | null = null;
let currentSettings: MauzSettings | null = null;
let inputProviders: InputProvider[] = [];
let bootstrapPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;
const shownPermissionMessages = new Set<string>();

type QuitEvent = {
  preventDefault(): void;
};

async function bootstrap(): Promise<void> {
  // Before SettingsService reads the environment, so a key that is only in .env shows in Settings.
  loadLocalEnv();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const preloadPath = join(__dirname, "../preload/index.cjs");
  const rendererFile = join(__dirname, "../renderer/index.html");
  const appIconPath = getAppIconPath();
  settingsService = new SettingsService();
  applyRuntimeEnvironment(await settingsService.getRuntime());

  configureAppIdentity(appIconPath);

  const excludeFromCapture = readBooleanEnv(
    process.env.MAUZ_EXCLUDE_FROM_CAPTURE,
    process.platform === "win32"
  );

  popover = new PopoverWindowController({
    preloadPath,
    rendererFile,
    iconPath: appIconPath,
    onHide: () => {
      // Hidden panels stay mounted; let Dictate release the microphone.
      const webContents = popover?.getWebContents();

      if (webContents !== null && webContents?.isDestroyed() === false) {
        webContents.send(IPC_CHANNELS.menuHidden);
      }
    },
    excludeFromCapture,
    ...(process.platform === "win32"
      ? {
          forceForeground: (handle: bigint) =>
            windowsContextHelper?.focusWindow(handle) ?? Promise.resolve(false)
        }
      : {}),
    ...(rendererUrl === undefined ? {} : { rendererUrl })
  });

  await popover.create();
  if (isShuttingDown()) {
    return;
  }

  if (process.platform === "win32") {
    // PowerShell + UI Automation take a few seconds to load; start before the first shake.
    windowsContextHelper = new WindowsContextHelper({
      coordinates: {
        toPhysicalPoint: (point) => screen.dipToScreenPoint(point),
        toDipRect: (rect) => screen.screenToDipRect(null, rect)
      }
    });
    windowsContextHelper.start();
  }

  await startBrowserBridge();

  // Sign-in checks for Claude Code / Codex take seconds; run them before the first question.
  void getAiProvidersStatus().catch(() => {});

  if (isShuttingDown()) {
    return;
  }

  const initialSettings = await settingsService.get();
  currentSettings = initialSettings;
  contextCollector = new ContextCollector({
    captureHider: popover,
    getCaptureBlockedApps: () => currentSettings?.captureBlockedApps ?? [],
    getCaptureBlockedSites: () => currentSettings?.captureBlockedSites ?? [],
    ...(browserBridge === null ? {} : { browserPageReader: browserBridge }),
    ...(windowsContextHelper === null ? {} : { windowsContextHelper })
  });
  subscriptionConnector = createSubscriptionConnector(broadcastSubscriptionConnectState);

  const taskAgentLauncher = new TaskAgentLauncher({ openExternal: (url) => shell.openExternal(url) });
  taskAgentLauncher.startHandoffCleanup();

  registerIpcHandlers({
    popover,
    contextCollector,
    getSettings: () => settingsService!.get(),
    updateSettings: applySettingsUpdate,
    taskAgents: {
      launcher: taskAgentLauncher,
      pickFolder: async () => {
        const options: Electron.OpenDialogOptions = {
          title: "Pick a folder for the agent",
          properties: ["openDirectory"]
        };
        const result =
          popover !== null
            ? await popover.withDialog((parent) => dialog.showOpenDialog(parent, options))
            : await dialog.showOpenDialog(options);

        return result.canceled ? null : (result.filePaths[0] ?? null);
      }
    },
    talkTranscriber: new TalkTranscriber({
      getWindowsHelper: () => windowsContextHelper,
      hasOpenAiKey: hasOpenAiTranscription,
      transcribeWithOpenAi: (wavAudio) => transcribeWithOpenAi(wavAudio)
    }),
    subscriptionConnector,
    openExternal: (url) => shell.openExternal(url),
    browserExtension: {
      status: () => ({
        connectedBrowsers: browserBridge?.connectedBrowsers() ?? [],
        extensionPath: getExtensionPath(),
        hostRegistered: browserHostRegistered
      }),
      openExtensionFolder: async () => {
        const extensionPath = getExtensionPath();

        if (extensionPath !== null) {
          await shell.openPath(extensionPath);
        }
      }
    }
  });
  startInputProviders(initialSettings);
  trayController = new TrayController({
    iconPath: getTrayIconPath(),
    onOpenMauz: () => void handleActivation(screen.getCursorScreenPoint()),
    onOpenSettings: () => void openSettings(),
    onToggleShake: (enabled) => {
      void applySettingsUpdate({ nativeShakeEnabled: enabled }).catch(() => {});
    },
    isShakeEnabled: () => currentSettings?.nativeShakeEnabled ?? true,
    onQuit: () => app.quit()
  });
  trayController.create();
  await openSettings();
}

/** Shows Settings in the popover at the pointer (startup, tray, a second launch). */
async function openSettings(): Promise<void> {
  if (popover === null) {
    return;
  }

  // Size for Settings up front, so the panel does not first show at menu size; its settings.open() resizes again.
  await popover.showAt(screen.getCursorScreenPoint(), { notifyActivation: false, forSettings: true });
  popover.getWebContents()?.send(IPC_CHANNELS.openSettings);
}

async function applySettingsUpdate(update: MauzSettingsUpdate): Promise<MauzSettings> {
  if (settingsService === null) {
    throw new Error("Mauz settings are not available yet.");
  }

  const settings = await settingsService.update(update);
  currentSettings = settings;
  applyRuntimeEnvironment(await settingsService.getRuntime());
  restartInputProviders(settings);
  trayController?.refresh();

  return settings;
}

function createInputProviders(settings: MauzSettings): InputProvider[] {
  const providers: InputProvider[] = [];
  const callbacks: InputProviderCallbacks = {
    onActivation: (event) => {
      void handleActivation(event.cursor);
    },
    onPermissionError: (error) => {
      popover?.hide();
      showPermissionError(error);
    }
  };

  if (settings.devHotkeyEnabled) {
    providers.push(new DevHotkeyInputProvider(callbacks));
  }

  if (settings.nativeShakeEnabled) {
    const detector = new ShakeDetector(getShakeDetectorConfigForSensitivity(settings.shakeSensitivity));

    if (process.platform === "darwin") {
      providers.push(
        new MacInputAgentProvider(callbacks, { helperPath: getNativeInputAgentPath(), detector })
      );
    } else {
      // Windows and Linux: sample the cursor; no native helper or OS permission needed.
      providers.push(
        new CursorPollingInputProvider(callbacks, {
          readCursor: () => screen.getCursorScreenPoint(),
          detector
        })
      );
    }
  }

  return providers;
}

function applyRuntimeEnvironment(settings: MauzRuntimeSettings): void {
  if (settings.openAiApiKey?.trim()) {
    process.env.OPENAI_API_KEY = settings.openAiApiKey.trim();
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  if (settings.anthropicApiKey?.trim()) {
    process.env.ANTHROPIC_API_KEY = settings.anthropicApiKey.trim();
  } else {
    delete process.env.ANTHROPIC_API_KEY;
  }

  process.env.MAUZ_AI_PROVIDER = settings.aiProvider;
  process.env.OPENAI_ASK_MODEL = settings.askModel;

  process.env.MAUZ_INSTALL_ID = settings.installId;
}

function configureAppIdentity(iconPath: string): void {
  app.setName("MauzAI");
  app.setAppUserModelId("ai.mauz.desktop");
  app.setAboutPanelOptions({
    applicationName: "MauzAI",
    applicationVersion: app.getVersion(),
    iconPath
  });
}

/**
 * Listens for the browser extension's native host and registers that host with Chrome and
 * Edge. Optional: Mauz works without it, so failures are ignored.
 */
async function startBrowserBridge(): Promise<void> {
  const pipePath = getBrowserPipePath(app.getPath("userData"), userInfo().username);
  const installDir = join(app.getPath("userData"), "browser-host");
  let bridge: BrowserBridge;
  let token: string;

  try {
    token = await loadOrCreateBrowserToken(installDir);
    bridge = new BrowserBridge(pipePath, token);
    await bridge.start();
    browserBridge = bridge;
  } catch {
    return;
  }

  const hostScriptPath = findRepoPath("browser-extension/native-host/host.cjs");

  if (hostScriptPath === null || (process.platform !== "win32" && process.platform !== "darwin")) {
    return;
  }

  try {
    await registerNativeHost({
      hostScriptPath,
      installDir,
      execPath: process.execPath,
      pipePath,
      token
    });
    browserHostRegistered = true;
  } catch {
    browserHostRegistered = false;
  }
}

function getExtensionPath(): string | null {
  const manifestPath = findRepoPath("browser-extension/extension/manifest.json");

  return manifestPath === null ? null : dirname(manifestPath);
}

/** A file from the repository checkout (Mauz runs from a clone). */
function findRepoPath(relativePath: string): string | null {
  const candidates = [
    resolve(app.getAppPath(), "../..", relativePath),
    resolve(app.getAppPath(), relativePath),
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), "../..", relativePath),
    resolve(__dirname, "../../../..", relativePath)
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function getAppIconPath(): string {
  // macOS uses the .icns bundle icon; Windows and Linux window icons need a PNG.
  return findBuildAsset(process.platform === "darwin" ? "mauzai.icns" : "mauzai.png");
}

function getTrayIconPath(): string {
  return findBuildAsset("mauzai-tray.png");
}

function findBuildAsset(fileName: string): string {
  const candidates = [
    resolve(process.resourcesPath, fileName),
    resolve(process.cwd(), "build", fileName),
    resolve(process.cwd(), "apps/desktop/build", fileName),
    resolve(__dirname, "../../build", fileName),
    resolve(__dirname, "../../../../apps/desktop/build", fileName)
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function getNativeInputAgentPath(): string {
  const configuredHelperPath = process.env.MAUZ_INPUT_AGENT_PATH?.trim();

  if (configuredHelperPath && existsSync(configuredHelperPath)) {
    return configuredHelperPath;
  }

  const candidates = [
    resolve(
      dirname(process.execPath),
      "../Resources/app/native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(dirname(process.execPath), "../Resources/app/native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      process.resourcesPath,
      "app/native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(process.resourcesPath, "app/native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(app.getAppPath(), "native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"),
    resolve(app.getAppPath(), "native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      app.getAppPath(),
      "../../native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(app.getAppPath(), "../../native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(process.cwd(), "native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"),
    resolve(process.cwd(), "native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      __dirname,
      "../../../../native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(__dirname, "../../../../native/macos/MauzInputAgent/MauzInputAgent")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function startInputProviders(settings: MauzSettings): void {
  inputProviders = createInputProviders(settings);

  for (const provider of inputProviders) {
    provider.start();
  }
}

function restartInputProviders(settings: MauzSettings): void {
  const providers = inputProviders;
  inputProviders = [];

  for (const provider of providers) {
    provider.stop();
  }

  // Clear dedup so recurring permission errors re-notify after a provider restart.
  shownPermissionMessages.clear();
  startInputProviders(settings);
}

async function handleActivation(cursor: { x: number; y: number }): Promise<void> {
  // A question is likely; start the answer provider (e.g. the Claude Code CLI) while the menu is open.
  prewarmAnswerProvider();

  try {
    await contextCollector?.prepareForActivation(cursor);
  } finally {
    await popover?.showAt(cursor);
  }
}

function startBootstrap(): void {
  if (bootstrapPromise !== null || isShuttingDown()) {
    return;
  }

  bootstrapPromise = bootstrap()
    .catch(() => {
      if (isShuttingDown()) {
        return;
      }

      showBootstrapError();
      beginShutdown();
    })
    .finally(() => {
      bootstrapPromise = null;
    });
}

function beginShutdown(): void {
  if (shutdownComplete) {
    app.quit();
    return;
  }

  shutdownPromise ??= shutdownResources()
    .catch((error: unknown) => {
      reportShutdownError("finish shutdown", error);
    })
    .finally(() => {
      shutdownComplete = true;
      app.quit();
    });
}

async function shutdownResources(): Promise<void> {
  const providers = inputProviders;
  inputProviders = [];

  for (const provider of providers) {
    try {
      provider.stop();
    } catch (error: unknown) {
      reportShutdownError("stop an input provider", error);
    }
  }

  trayController?.destroy();
  trayController = null;
  windowsContextHelper?.stop();
  windowsContextHelper = null;
  browserBridge?.stop();
  browserBridge = null;

  subscriptionConnector?.dispose();
  subscriptionConnector = null;

  try {
    disposeAnswerProviders();
  } catch (error: unknown) {
    reportShutdownError("stop the answer providers", error);
  }

  const currentPopover = popover;
  popover = null;
  contextCollector = null;
  settingsService = null;

  try {
    currentPopover?.destroy();
  } catch (error: unknown) {
    reportShutdownError("destroy application windows", error);
  }
}

function isShuttingDown(): boolean {
  return shutdownPromise !== null || shutdownComplete;
}

function showBootstrapError(): void {
  dialog.showErrorBox(
    "Mauz couldn't start",
    "Mauz couldn't start its desktop runtime. Restart the app. If this keeps happening, check the application logs for startup errors."
  );
}

function showPermissionError(error: PermissionError): void {
  const { message } = error;

  if (shownPermissionMessages.has(message)) {
    return;
  }

  shownPermissionMessages.add(message);
  dialog.showErrorBox("Mauz permission needed", message);

  const webContents = popover?.getWebContents();

  if (webContents !== null && webContents?.isDestroyed() === false) {
    webContents.send(IPC_CHANNELS.permissionError, error);
  }
}

function reportShutdownError(action: string, error: unknown): void {
  void error;
  console.error(`Mauz shutdown could not ${action}.`);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    void openSettings();
  });

  void app.whenReady().then(startBootstrap);

  app.on("activate", () => {
    if (popover === null) {
      startBootstrap();
    } else {
      void openSettings();
    }
  });

  app.on("before-quit", (event: QuitEvent) => {
    if (shutdownComplete) {
      return;
    }

    event.preventDefault();
    beginShutdown();
  });

  app.on("will-quit", () => {
    for (const provider of inputProviders) {
      provider.stop();
    }
  });

  app.on("window-all-closed", () => {
    // Keep the resident assistant alive after popup windows close.
  });
}

const openedConnectPages = new Set<string>();

/** Sends sign-in progress to every Mauz window; device sign-in pages open automatically. */
function broadcastSubscriptionConnectState(state: SubscriptionConnectState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.webContents.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.providersConnectState, state);
    }
  }

  // Claude Code opens the browser itself; Codex device sign-in only prints the link.
  if (
    state.phase === "waiting" &&
    !state.acceptsPastedCode &&
    state.url?.startsWith("https://") === true &&
    !openedConnectPages.has(state.connectId)
  ) {
    openedConnectPages.add(state.connectId);
    void shell.openExternal(state.url).catch(() => {});
  }
}
