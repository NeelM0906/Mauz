import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MauzBridge, TaskAgentsResponse } from "@mauzai/shared";
import { mauzClient } from "../src/renderer/src/lib/mauzClient";

describe("mauzClient", () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      location: { protocol: "http:" }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  describe("getTaskAgents", () => {
    it("returns the bridge result", async () => {
      const result: TaskAgentsResponse = {
        agents: [{ id: "claude-code", label: "Claude Code", installed: true }],
        selectedAgentId: "claude-code"
      };
      const agents = vi.fn().mockResolvedValue(result);
      const bridge: Partial<MauzBridge> = {
        task: { agents, folders: vi.fn(), pickFolder: vi.fn(), send: vi.fn() }
      };

      (globalThis as unknown as { window: { mauz: Partial<MauzBridge> } }).window.mauz = bridge;

      await expect(mauzClient.getTaskAgents()).resolves.toEqual(result);
      expect(agents).toHaveBeenCalledTimes(1);
    });

    it("falls back to the browser preview bridge when the desktop bridge is missing", async () => {
      const result = await mauzClient.getTaskAgents();

      expect(result.selectedAgentId).toBeNull();
      expect(result.agents.map((agent) => agent.id)).toEqual(["hermes", "claude-code", "codex"]);
    });
  });
});
