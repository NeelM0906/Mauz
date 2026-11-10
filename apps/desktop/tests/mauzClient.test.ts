import { afterEach, describe, expect, it } from "vitest";
import type { MauzBridge } from "@mauzai/shared";
import { mauz } from "../src/renderer/src/lib/mauzClient";

describe("mauz", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("returns the preload bridge", () => {
    const bridge = {} as MauzBridge;
    (globalThis as unknown as { window: { mauz: MauzBridge } }).window = { mauz: bridge };

    expect(mauz()).toBe(bridge);
  });

  it("throws when the preload bridge is missing", () => {
    (globalThis as unknown as { window: object }).window = {};

    expect(() => mauz()).toThrow("Mauz desktop bridge is unavailable.");
  });
});
