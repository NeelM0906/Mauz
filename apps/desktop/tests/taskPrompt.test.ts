import { describe, expect, it } from "vitest";
import type { GatewayReadinessStatus } from "@mauzai/shared";
import { buildTaskPrompt, canSubmitTask } from "../src/renderer/src/lib/taskPrompt";

describe("buildTaskPrompt", () => {
  it("frames a trimmed outcome as a supervised Hermes task", () => {
    expect(buildTaskPrompt("  Fix the failing import flow.  ")).toBe(
      [
        "Work task outcome: Fix the failing import flow.",
        "",
        "Hermes: first state a concise plan. Then conduct read-only investigation before making any changes. Request approval before any mutation."
      ].join("\n")
    );
  });

  it("rejects an empty outcome", () => {
    expect(() => buildTaskPrompt("   ")).toThrow("Task outcome is required.");
  });

  it.each(["simple", "unavailable", "unsupported"] as const)("blocks %s gateways", (status) => {
    expect(canSubmitTask("One outcome", status, false)).toBe(false);
  });

  it("accepts shared gateway readiness statuses", () => {
    const status: GatewayReadinessStatus = "ready";
    expect(canSubmitTask("One outcome", status, false)).toBe(true);
  });

  it("requires a ready gateway, an outcome, and no active submission", () => {
    expect(canSubmitTask("One outcome", "ready", false)).toBe(true);
    expect(canSubmitTask("", "ready", false)).toBe(false);
    expect(canSubmitTask("One outcome", "ready", true)).toBe(false);
  });
});
