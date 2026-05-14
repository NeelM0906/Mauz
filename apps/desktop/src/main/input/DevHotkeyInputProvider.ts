import { globalShortcut, screen } from "electron";
import type { ActivationEvent, InputProvider, Unsubscribe } from "./InputProvider";

const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+M";

export class DevHotkeyInputProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private registered = false;

  constructor(private readonly accelerator = DEFAULT_ACCELERATOR) {}

  start(): void {
    if (this.registered) {
      return;
    }

    this.registered = globalShortcut.register(this.accelerator, () => {
      const cursor = screen.getCursorScreenPoint();
      this.emitActivation({
        source: "dev-hotkey",
        cursor
      });
    });
  }

  stop(): void {
    if (!this.registered) {
      return;
    }

    globalShortcut.unregister(this.accelerator);
    this.registered = false;
  }

  onActivation(callback: (event: ActivationEvent) => void): Unsubscribe {
    this.activationListeners.add(callback);
    return () => {
      this.activationListeners.delete(callback);
    };
  }

  onPermissionError(): Unsubscribe {
    return () => {};
  }

  private emitActivation(event: ActivationEvent): void {
    for (const listener of this.activationListeners) {
      listener(event);
    }
  }
}
