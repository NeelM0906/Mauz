import { app, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HERMES_BASE_URL,
  IPC_CHANNELS,
  type MauzSettings,
  type MauzSettingsUpdate,
  type PermissionError
} from "@mauzai/shared";
import { AgentRunBridge } from "./agent/AgentRunBridge";
import { ChatHistoryService } from "./chat/ChatHistoryService";
import { ContextCollector } from "./context/ContextCollector";
import { DevHotkeyInputProvider } from "./input/DevHotkeyInputProvider";
import type { InputProvider } from "./input/InputProvider";
import { MacInputAgentProvider } from "./input/MacInputAgentProvider";
import { getShakeDetectorConfigForSensitivity, ShakeDetector } from "./input/ShakeDetector";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import {
  getConfiguredLocalApiPort,
  isPortUnavailable,
  launchLocalApi,
  type LocalApiHandle
} from "./server/launchLocalApi";
import { SettingsService, type MauzRuntimeSettings } from "./settings/SettingsService";
import { DesktopWindowController } from "./windows/DesktopWindowController";
import { PopoverWindowController } from "./windows/PopoverWindowController";

const __dirname = dirname(fileURLToPath(import.meta.url));

let desktopWindow: DesktopWindowController | null = null;
let popover: PopoverWindowController | null = null;
let apiHandle: LocalApiHandle | null = null;
let contextCollector: ContextCollector | null = null;
let chatHistoryService: ChatHistoryService | null = null;
let settingsService: SettingsService | null = null;
let inputProviders: InputProvider[] = [];
let bootstrapPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;
const shownPermissionMessages = new Set<string>();

type QuitEvent = {
  preventDefault(): void;
};

async function bootstrap(): Promise<void> {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  const preloadPath = join(__dirname, "../preload/index.cjs");
  const rendererFile = join(__dirname, "../renderer/index.html");
  const appIconPath = getAppIconPath();
  settingsService = new SettingsService();
  applyRuntimeEnvironment(await settingsService.getRuntime());

  configureAppIdentity(appIconPath);

  desktopWindow = new DesktopWindowController({
    preloadPath,
    rendererFile,
    iconPath: appIconPath,
    ...(rendererUrl === undefined ? {} : { rendererUrl })
  });

  const agentRunBridge = new AgentRunBridge({
    getPopoverWebContents: () => popover?.getWebContents() ?? null,
    showPopover: () => {
      void popover?.showAtLastAnchor({ notifyActivation: false, preserveSize: true });
    }
  });

  popover = new PopoverWindowController({
    preloadPath,
    rendererFile,
    iconPath: appIconPath,
    onHide: (reason) => {
      if (reason === "explicit") {
        void agentRunBridge.stopActiveRun();
      }
    },
    ...(rendererUrl === undefined ? {} : { rendererUrl })
  });

  await popover.create();
  if (isShuttingDown()) {
    return;
  }

  const localApiToken = randomUUID();
  const launchedApi = await launchLocalApi({
    authToken: localApiToken,
    runHooks: agentRunBridge.runHooks
  });

  if (isShuttingDown()) {
    await stopLocalApi(launchedApi);
    return;
  }

  apiHandle = launchedApi;
  chatHistoryService = ChatHistoryService.fromUserDataDir(app.getPath("userData"));
  const initialSettings = await settingsService.get();
  contextCollector = new ContextCollector({
    captureHider: popover
  });
  registerIpcHandlers({
    popover,
    contextCollector,
    chatHistory: chatHistoryService,
    api: apiHandle,
    localApiToken,
    getSettings: () => settingsService!.get(),
    updateSettings: applySettingsUpdate,
    agentRunBridge
  });
  startInputProviders(initialSettings);
  await desktopWindow.show();
}

async function applySettingsUpdate(update: MauzSettingsUpdate): Promise<MauzSettings> {
  if (settingsService === null) {
    throw new Error("Mauz settings are not available yet.");
  }

  const settings = await settingsService.update(update);
  applyRuntimeEnvironment(await settingsService.getRuntime());
  restartInputProviders(settings);

  return settings;
}

function createInputProviders(settings: MauzSettings): InputProvider[] {
  const providers: InputProvider[] = [];

  if (settings.devHotkeyEnabled) {
    providers.push(new DevHotkeyInputProvider());
  }

  if (process.platform === "darwin" && settings.nativeShakeEnabled) {
    const helperPath = getNativeInputAgentPath();
    providers.push(
      new MacInputAgentProvider({
        helperPath,
        detector: new ShakeDetector(getShakeDetectorConfigForSensitivity(settings.shakeSensitivity))
      })
    );
  }

  return providers;
}

function applyRuntimeEnvironment(settings: MauzRuntimeSettings): void {
  if (settings.openAiApiKey?.trim()) {
    process.env.OPENAI_API_KEY = settings.openAiApiKey.trim();
  } else {
    delete process.env.OPENAI_API_KEY;
  }

  process.env.OPENAI_ASK_MODEL = settings.askModel;
  process.env.OPENAI_CHAT_TITLE_MODEL = settings.chatTitleModel;
  process.env.OPENAI_REALTIME_MODEL = settings.realtimeModel;
  process.env.OPENAI_REALTIME_VOICE = settings.realtimeVoice;
  process.env.OPENAI_REALTIME_REASONING_EFFORT = settings.realtimeReasoningEffort;
  process.env.OPENAI_INCLUDE_FULL_SCREENSHOT = settings.includeFullScreenshot ? "true" : "false";

  const backendBaseUrl = resolveBackendBaseUrl(settings);

  if (backendBaseUrl === undefined) {
    delete process.env.MAUZ_BACKEND_BASE_URL;
  } else {
    process.env.MAUZ_BACKEND_BASE_URL = backendBaseUrl;
  }

  // The API package reads MAUZ_BACKEND_PRESET to derive the answer label.
  // Keep the env var name stable; map "agentic" → "hermes" so the API side works unchanged.
  if (settings.assistantMode === "agentic") {
    process.env.MAUZ_BACKEND_PRESET = "hermes";
  } else {
    delete process.env.MAUZ_BACKEND_PRESET;
  }

  process.env.MAUZ_AGENT_MODE = settings.agentMode;
  process.env.MAUZ_INSTALL_ID = settings.installId;
}

function resolveBackendBaseUrl(settings: MauzRuntimeSettings): string | undefined {
  if (settings.assistantMode !== "agentic") {
    return undefined;
  }

  const configured = settings.backendBaseUrl.trim();

  return configured.length > 0 ? configured : DEFAULT_HERMES_BASE_URL;
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

function getAppIconPath(): string {
  const candidates = [
    resolve(process.resourcesPath, "mauzai.icns"),
    resolve(process.cwd(), "build/mauzai.icns"),
    resolve(process.cwd(), "apps/desktop/build/mauzai.icns"),
    resolve(__dirname, "../../build/mauzai.icns"),
    resolve(__dirname, "../../../../apps/desktop/build/mauzai.icns")
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
    provider.onActivation((event) => {
      void handleActivation(event.cursor);
    });
    provider.onPermissionError((error) => {
      popover?.hide();
      showPermissionError(error);
    });
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
    .catch((error: unknown) => {
      if (isShuttingDown()) {
        return;
      }

      showBootstrapError(error);
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

  const currentPopover = popover;
  const currentDesktopWindow = desktopWindow;
  desktopWindow = null;
  popover = null;
  contextCollector = null;
  chatHistoryService = null;
  settingsService = null;

  try {
    currentDesktopWindow?.destroy();
    currentPopover?.destroy();
  } catch (error: unknown) {
    reportShutdownError("destroy application windows", error);
  }

  const currentApiHandle = apiHandle;
  apiHandle = null;

  if (currentApiHandle !== null) {
    await stopLocalApi(currentApiHandle);
  }
}

async function stopLocalApi(handle: LocalApiHandle): Promise<void> {
  try {
    await handle.stop();
  } catch (error: unknown) {
    reportShutdownError("stop the local API", error);
  }
}

function isShuttingDown(): boolean {
  return shutdownPromise !== null || shutdownComplete;
}

function showBootstrapError(error: unknown): void {
  const title = "Mauz couldn't start";

  if (isPortUnavailable(error)) {
    dialog.showErrorBox(
      title,
      `The local API server could not start after trying ports from ${getConfiguredLocalApiPort()} upward. Close the other process or set MAUZ_API_PORT to an available port, then reopen Mauz.`
    );
    return;
  }

  dialog.showErrorBox(
    title,
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
    void desktopWindow?.show();
  });

  void app.whenReady().then(startBootstrap);

  app.on("activate", () => {
    if (desktopWindow === null || popover === null) {
      startBootstrap();
    } else {
      void desktopWindow.show();
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
