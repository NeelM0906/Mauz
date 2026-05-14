import { app } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readBooleanEnv } from "@mauzai/shared";
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
  apiHandle = await launchLocalApi();
  const contextCollector = new ContextCollector({
    captureHider: popover
  });
  registerIpcHandlers({ popover, contextCollector, api: apiHandle });
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

app.whenReady().then(() => {
  void bootstrap();
});

app.on("activate", () => {
  if (popover === null) {
    void bootstrap();
  }
});

app.on("before-quit", () => {
  for (const provider of inputProviders) {
    provider.stop();
  }

  inputProviders = [];
  popover?.destroy();
  void apiHandle?.stop();
});

app.on("window-all-closed", () => {
  // Keep the resident assistant alive after popup windows close.
});
