import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayReadinessResult, MauzBridge } from "@mauzai/shared";
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

  describe("getGatewayReadinessStatus", () => {
    it("returns the bridge result", async () => {
      const result: GatewayReadinessResult = {
        status: "ready",
        message: "Gateway is ready for supervised Work tasks."
      };
      const getGatewayReadinessStatus = vi.fn().mockResolvedValue(result);
      const bridge: Partial<MauzBridge> = {
        agent: {
          getGatewayReadinessStatus,
          respondApproval: vi.fn(),
          stop: vi.fn(),
          onApprovalRequest: vi.fn(),
          onRunState: vi.fn(),
          onRunActivity: vi.fn()
        }
      };

      (globalThis as unknown as { window: { mauz: Partial<MauzBridge> } }).window.mauz = bridge;

      await expect(mauzClient.getGatewayReadinessStatus()).resolves.toEqual(result);
      expect(getGatewayReadinessStatus).toHaveBeenCalledTimes(1);
    });

    it("falls back to the browser preview bridge when the desktop bridge is missing", async () => {
      const result = await mauzClient.getGatewayReadinessStatus();
      expect(result.status).toBe("simple");
      expect(result.message.length).toBeGreaterThan(0);
      expect(result.message.length).toBeLessThanOrEqual(200);
    });
  });
});
