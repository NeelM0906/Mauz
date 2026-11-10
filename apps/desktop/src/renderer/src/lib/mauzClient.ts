import type { MauzBridge } from "@mauzai/shared";

/** The preload bridge. It throws when the preload script did not run. */
export function mauz(): MauzBridge {
  if (window.mauz === undefined) {
    throw new Error("Mauz desktop bridge is unavailable. Quit and reopen the installed MauzAI app.");
  }

  return window.mauz;
}
