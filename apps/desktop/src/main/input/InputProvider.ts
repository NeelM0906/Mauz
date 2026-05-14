import type { PermissionError } from "@mauzai/shared";

export type ActivationSource = "dev-hotkey" | "mouse-shake";

export type ActivationEvent = {
  source: ActivationSource;
  cursor: {
    x: number;
    y: number;
  };
};

export type InputProviderEvents = {
  activated: ActivationEvent;
  permissionError: PermissionError;
};

export type Unsubscribe = () => void;

export interface InputProvider {
  start(): void;
  stop(): void;
  onActivation(callback: (event: ActivationEvent) => void): Unsubscribe;
  onPermissionError(callback: (error: PermissionError) => void): Unsubscribe;
}
