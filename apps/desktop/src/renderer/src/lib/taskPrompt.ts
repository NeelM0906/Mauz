import type { GatewayReadinessStatus } from "@mauzai/shared";

export function canSubmitTask(
  outcome: string,
  readinessStatus: GatewayReadinessStatus,
  isLoading: boolean
): boolean {
  return readinessStatus === "ready" && outcome.trim().length > 0 && !isLoading;
}

export function buildTaskPrompt(outcome: string): string {
  const trimmedOutcome = outcome.trim();

  if (trimmedOutcome.length === 0) {
    throw new Error("Task outcome is required.");
  }

  return [
    `Work task outcome: ${trimmedOutcome}`,
    "",
    "Hermes: first state a concise plan. Then conduct read-only investigation before making any changes. Request approval before any mutation."
  ].join("\n");
}
