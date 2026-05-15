import { app, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { MauzSettings, MauzSettingsUpdate } from "@mauzai/shared";
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
  const preloadPath = join(__dirname, "../preload/index.mjs");
  const rendererFile = join(__dirname, "../renderer/index.html");
  settingsService = new SettingsService();
  applyRuntimeEnvironment(await settingsService.getRuntime());

  app.setName("MauzAI");

  desktopWindow = new DesktopWindowController({
    preloadPath,
    rendererFile,
    ...(rendererUrl === undefined ? {} : { rendererUrl })
  });

  popover = new PopoverWindowController({
    preloadPath,
    rendererFile,
    ...(rendererUrl === undefined ? {} : { rendererUrl })
  });

  await popover.create();
  if (isShuttingDown()) {
    return;
  }

  const localApiToken = randomUUID();
  const launchedApi = await launchLocalApi({
    authToken: localApiToken
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
    updateSettings: applySettingsUpdate
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
    providers.push(
      new MacInputAgentProvider({
        helperPath: getNativeInputAgentPath(),
        detector: new ShakeDetector(getShakeDetectorConfigForSensitivity(settings.shakeSensitivity))
      })
    );
  }

  return providers;
}

function applyRuntimeEnvironment(settings: MauzRuntimeSettings): void {
  process.env.OPENAI_AUTH_MODE = settings.openAiAuthMode;

  if (settings.openAiAuthMode === "api-key" && settings.openAiApiKey?.trim()) {
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
}

function getNativeInputAgentPath(): string {
  if (process.env.MAUZ_INPUT_AGENT_PATH !== undefined && process.env.MAUZ_INPUT_AGENT_PATH.length > 0) {
    return process.env.MAUZ_INPUT_AGENT_PATH;
  }

  const candidates = [
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
      showPermissionError(error.message);
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

  startInputProviders(settings);
}

async function handleActivation(cursor: { x: number; y: number }): Promise<void> {
  try {
    await contextCollector?.prepareForActivation();
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

function showPermissionError(message: string): void {
  if (shownPermissionMessages.has(message)) {
    return;
  }

  shownPermissionMessages.add(message);
  dialog.showErrorBox("Mauz permission needed", message);
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
