import { app, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MauzSettings, MauzSettingsUpdate } from "@mauzai/shared";
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
import { SettingsService } from "./settings/SettingsService";
import { PopoverWindowController } from "./windows/PopoverWindowController";

const __dirname = dirname(fileURLToPath(import.meta.url));

let popover: PopoverWindowController | null = null;
let apiHandle: LocalApiHandle | null = null;
let contextCollector: ContextCollector | null = null;
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
  settingsService = new SettingsService();
  const initialSettings = await settingsService.get();
  contextCollector = new ContextCollector({
    captureHider: popover
  });
  registerIpcHandlers({
    popover,
    contextCollector,
    api: apiHandle,
    localApiToken,
    getSettings: () => settingsService!.get(),
    updateSettings: applySettingsUpdate
  });
  startInputProviders(initialSettings);
}

async function applySettingsUpdate(update: MauzSettingsUpdate): Promise<MauzSettings> {
  if (settingsService === null) {
    throw new Error("Mauz settings are not available yet.");
  }

  const settings = await settingsService.update(update);
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
        detector: new ShakeDetector(getShakeDetectorConfigForSensitivity(settings.shakeSensitivity))
      })
    );
  }

  return providers;
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
  popover = null;
  contextCollector = null;
  settingsService = null;

  try {
    currentPopover?.destroy();
  } catch (error: unknown) {
    reportShutdownError("destroy the popover", error);
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

void app.whenReady().then(startBootstrap);

app.on("activate", () => {
  if (popover === null) {
    startBootstrap();
  }
});

app.on("before-quit", (event: QuitEvent) => {
  if (shutdownComplete) {
    return;
  }

  event.preventDefault();
  beginShutdown();
});

app.on("window-all-closed", () => {
  // Keep the resident assistant alive after popup windows close.
});
