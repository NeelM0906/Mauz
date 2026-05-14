import { app, dialog } from "electron";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAUZ_API_PORT, readBooleanEnv } from "@mauzai/shared";
import { ContextCollector } from "./context/ContextCollector";
import { DevHotkeyInputProvider } from "./input/DevHotkeyInputProvider";
import type { InputProvider } from "./input/InputProvider";
import { MacInputAgentProvider } from "./input/MacInputAgentProvider";
import { registerIpcHandlers } from "./ipc/registerIpcHandlers";
import { launchLocalApi, type LocalApiHandle } from "./server/launchLocalApi";
import { PopoverWindowController } from "./windows/PopoverWindowController";

const __dirname = dirname(fileURLToPath(import.meta.url));

let popover: PopoverWindowController | null = null;
let apiHandle: LocalApiHandle | null = null;
let inputProviders: InputProvider[] = [];
let bootstrapPromise: Promise<void> | null = null;
let shutdownPromise: Promise<void> | null = null;
let shutdownComplete = false;

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
  const contextCollector = new ContextCollector({
    captureHider: popover
  });
  registerIpcHandlers({ popover, contextCollector, api: apiHandle, localApiToken });
  inputProviders = createInputProviders();

  for (const provider of inputProviders) {
    provider.onActivation((event) => {
      void popover?.showAt(event.cursor);
    });
    provider.onPermissionError((error) => {
      popover?.hide();
      // Permission UI lands with the native helper. For now the event is surfaced through preload once the window is shown.
      void error;
    });
    provider.start();
  }
}

function createInputProviders(): InputProvider[] {
  const providers: InputProvider[] = [];

  if (readBooleanEnv(process.env.MAUZ_ENABLE_DEV_HOTKEY, true)) {
    providers.push(new DevHotkeyInputProvider());
  }

  if (process.platform === "darwin" && readBooleanEnv(process.env.MAUZ_ENABLE_NATIVE_INPUT, false)) {
    providers.push(new MacInputAgentProvider());
  }

  return providers;
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
      `The local API server could not start because port ${getConfiguredLocalApiPort()} is already in use. Close the other process or set MAUZ_API_PORT to an available port, then reopen Mauz.`
    );
    return;
  }

  dialog.showErrorBox(
    title,
    "Mauz couldn't start its desktop runtime. Restart the app. If this keeps happening, check the application logs for startup errors."
  );
}

function getConfiguredLocalApiPort(): number {
  const configuredPort = Number.parseInt(process.env.MAUZ_API_PORT ?? String(DEFAULT_MAUZ_API_PORT), 10);

  return Number.isFinite(configuredPort) ? configuredPort : DEFAULT_MAUZ_API_PORT;
}

function isPortUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  if ("code" in error && error.code === "EADDRINUSE") {
    return true;
  }

  return "cause" in error && isPortUnavailable(error.cause);
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
