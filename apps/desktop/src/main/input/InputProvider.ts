import type { PermissionError } from "@mauzai/shared";

export type ActivationEvent = {
  cursor: {
    x: number;
    y: number;
  };
};

/** What a provider calls when it activates or fails. `index.ts` is the only subscriber. */
export type InputProviderCallbacks = {
  onActivation(event: ActivationEvent): void;
  onPermissionError(error: PermissionError): void;
};

export interface InputProvider {
  start(): void;
  stop(): void;
}
