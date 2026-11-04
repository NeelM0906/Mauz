import { describe, expect, it } from "vitest";
import { CursorPollingInputProvider } from "../src/main/input/CursorPollingInputProvider";
import type { ActivationEvent } from "../src/main/input/InputProvider";

type ScheduledTick = {
  callback: () => void;
  delayMs: number;
};

function createHarness(path: Array<{ x: number; y: number }>) {
  let clock = 0;
  let index = 0;
  let pending: ScheduledTick | null = null;
  const activations: ActivationEvent[] = [];
  const delays: number[] = [];
  const provider = new CursorPollingInputProvider({
    readCursor: () => path[Math.min(index++, path.length - 1)]!,
    now: () => clock,
    schedule: (callback, delayMs) => {
      pending = { callback, delayMs };
      delays.push(delayMs);
      return pending;
    },
    cancel: () => {
      pending = null;
    }
  });

  provider.onActivation((event) => activations.push(event));

  return {
    provider,
    activations,
    delays,
    runTicks(count: number) {
      for (let tick = 0; tick < count && pending !== null; tick += 1) {
        const current: ScheduledTick = pending;
        clock += current.delayMs;
        current.callback();
      }
    }
  };
}

function verticalShake(): Array<{ x: number; y: number }> {
  const points = [{ x: 500, y: 500 }];

  for (let swing = 0; swing < 8; swing += 1) {
    const top = swing % 2 === 0 ? 380 : 620;
    for (let step = 1; step <= 4; step += 1) {
      const previous = points[points.length - 1]!;
      points.push({ x: 500, y: previous.y + (top - previous.y) * (step / 4) });
    }
  }

  return points;
}

describe("CursorPollingInputProvider", () => {
  it("activates on a vertical mouse shake", () => {
    const harness = createHarness(verticalShake());

    harness.provider.start();
    harness.runTicks(60);

    expect(harness.activations).toHaveLength(1);
    expect(harness.activations[0]?.source).toBe("mouse-shake");
  });

  it("does not activate while the pointer is still", () => {
    const harness = createHarness([{ x: 10, y: 10 }]);

    harness.provider.start();
    harness.runTicks(50);

    expect(harness.activations).toHaveLength(0);
  });

  it("polls slowly when idle and quickly after movement", () => {
    const harness = createHarness([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 80, y: 0 }
    ]);

    harness.provider.start();
    harness.runTicks(4);

    expect(harness.delays[0]).toBe(50);
    expect(harness.delays[1]).toBe(50);
    expect(harness.delays.slice(3)).toContain(16);
  });

  it("stops polling after stop()", () => {
    const harness = createHarness(verticalShake());

    harness.provider.start();
    harness.provider.stop();
    harness.runTicks(60);

    expect(harness.activations).toHaveLength(0);
  });
});
