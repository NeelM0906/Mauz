import { afterEach, describe, expect, it, vi } from "vitest";
import type { MauzBridge } from "@mauzai/shared";
import { goBackToMenu } from "../src/renderer/src/components/PanelHeader";
import { useMauzStore } from "../src/renderer/src/state/useMauzStore";

function stubBridge(showMenu: () => Promise<void>): void {
  (globalThis as unknown as { window: { mauz: MauzBridge } }).window = {
    mauz: { menu: { showMenu } } as unknown as MauzBridge
  };
}

describe("goBackToMenu", () => {
  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    useMauzStore.setState({ mode: "menu" });
  });

  it("resizes the popover before it shows the menu", async () => {
    const calls: string[] = [];
    stubBridge(async () => {
      calls.push(`showMenu while ${useMauzStore.getState().mode}`);
    });
    useMauzStore.setState({ mode: "ask" });

    await goBackToMenu();

    expect(calls).toEqual(["showMenu while ask"]);
    expect(useMauzStore.getState().mode).toBe("menu");
  });

  it("still shows the menu when the resize fails", async () => {
    stubBridge(vi.fn().mockRejectedValue(new Error("no window")));
    useMauzStore.setState({ mode: "settings" });

    await expect(goBackToMenu()).rejects.toThrow("no window");
    expect(useMauzStore.getState().mode).toBe("menu");
  });
});
