import { globalShortcut, screen } from "electron";
import type { InputProvider, InputProviderCallbacks } from "./InputProvider";

const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+M";

export class DevHotkeyInputProvider implements InputProvider {
  private registered = false;

  constructor(
    private readonly callbacks: InputProviderCallbacks,
    private readonly accelerator = DEFAULT_ACCELERATOR
  ) {}

  start(): void {
    if (this.registered) {
      return;
    }

    globalShortcut.unregister(this.accelerator);
    this.registered = globalShortcut.register(this.accelerator, () => {
      const cursor = screen.getCursorScreenPoint();
      this.callbacks.onActivation({
        source: "dev-hotkey",
        cursor
      });
    });

    if (!this.registered) {
      this.callbacks.onPermissionError({
        permission: "unknown",
        message: `Mauz could not register ${this.accelerator}. Quit any other Mauz or Electron dev instance, then restart Mauz.`
      });
    }
  }

  stop(): void {
    if (!this.registered) {
      return;
    }

    globalShortcut.unregister(this.accelerator);
    this.registered = false;
  }
}
