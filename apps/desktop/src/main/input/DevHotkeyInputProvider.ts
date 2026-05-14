import { globalShortcut, screen } from "electron";
import type { PermissionError } from "@mauzai/shared";
import type { ActivationEvent, InputProvider, Unsubscribe } from "./InputProvider";

const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+M";

export class DevHotkeyInputProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private readonly permissionListeners = new Set<(error: PermissionError) => void>();
  private registered = false;

  constructor(private readonly accelerator = DEFAULT_ACCELERATOR) {}

  start(): void {
    if (this.registered) {
      return;
    }

    globalShortcut.unregister(this.accelerator);
    this.registered = globalShortcut.register(this.accelerator, () => {
      const cursor = screen.getCursorScreenPoint();
      this.emitActivation({
        source: "dev-hotkey",
        cursor
      });
    });

    if (!this.registered) {
      this.emitPermissionError({
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

  onActivation(callback: (event: ActivationEvent) => void): Unsubscribe {
    this.activationListeners.add(callback);
    return () => {
      this.activationListeners.delete(callback);
    };
  }

  onPermissionError(callback: (error: PermissionError) => void): Unsubscribe {
    this.permissionListeners.add(callback);
    return () => {
      this.permissionListeners.delete(callback);
    };
  }

  private emitActivation(event: ActivationEvent): void {
    for (const listener of this.activationListeners) {
      listener(event);
    }
  }

  private emitPermissionError(error: PermissionError): void {
    for (const listener of this.permissionListeners) {
      listener(error);
    }
  }
}
