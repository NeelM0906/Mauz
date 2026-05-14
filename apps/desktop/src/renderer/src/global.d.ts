import type { MauzBridge } from "@mauzai/shared";

declare global {
  interface Window {
    mauz: MauzBridge;
  }
}

export {};
