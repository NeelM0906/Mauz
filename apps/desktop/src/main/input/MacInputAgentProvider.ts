import type { PermissionError } from "@mauzai/shared";
import type { ActivationEvent, InputProvider, Unsubscribe } from "./InputProvider";

export class MacInputAgentProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private readonly permissionListeners = new Set<(error: PermissionError) => void>();

  start(): void {
    // The Swift helper is intentionally left for the next milestone.
  }

  stop(): void {
    this.activationListeners.clear();
    this.permissionListeners.clear();
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
}
