import { describe, expect, it } from "vitest";
import type { MouseMoveSample } from "@mauzai/shared";
import { getShakeDetectorConfigForSensitivity, ShakeDetector } from "../src/main/input/ShakeDetector";

function feed(detector: ShakeDetector, samples: MouseMoveSample[]): boolean {
  let activated = false;

  for (const sample of samples) {
    activated = detector.push(sample).activated || activated;
  }

  return activated;
}

function verticalShake(
  startTs = 1_000,
  options: { buttons?: number; xDrift?: number } = {}
): MouseMoveSample[] {
  const yValues = [100, 225, 95, 222, 90, 218, 85];
  const xDrift = options.xDrift ?? 24;

  return yValues.map((y, index) => ({
    x: 300 + Math.round((index / (yValues.length - 1)) * xDrift),
    y,
    ts: startTs + index * 110,
    ...(options.buttons === undefined ? {} : { buttons: options.buttons })
  }));
}

function horizontalShake(
  startTs = 1_000,
  options: { buttons?: number; yDrift?: number } = {}
): MouseMoveSample[] {
  const xValues = [100, 225, 95, 222, 90, 218, 85];
  const yDrift = options.yDrift ?? 24;

  return xValues.map((x, index) => ({
    x,
    y: 300 + Math.round((index / (xValues.length - 1)) * yDrift),
    ts: startTs + index * 110,
    ...(options.buttons === undefined ? {} : { buttons: options.buttons })
  }));
}

describe("ShakeDetector", () => {
  it("does not activate on normal mouse movement", () => {
    const detector = new ShakeDetector();
    const samples = Array.from({ length: 12 }, (_, index) => ({
      x: 100 + index * 12,
      y: 100 + index * 20,
      ts: 1_000 + index * 80
    }));

    expect(feed(detector, samples)).toBe(false);
  });

  it("activates on rapid up/down movement", () => {
    const detector = new ShakeDetector();

    expect(feed(detector, verticalShake())).toBe(true);
  });

  it("activates on rapid side-to-side movement", () => {
    const detector = new ShakeDetector();

    expect(feed(detector, horizontalShake())).toBe(true);
  });

  it("does not activate during cooldown", () => {
    const detector = new ShakeDetector();

    expect(feed(detector, verticalShake(1_000))).toBe(true);
    expect(feed(detector, verticalShake(2_100))).toBe(false);
    expect(feed(detector, verticalShake(4_300))).toBe(true);
  });

  it("ignores tiny jitter", () => {
    const detector = new ShakeDetector();
    const samples = [100, 105, 98, 106, 99, 104, 100, 103].map((y, index) => ({
      x: 200 + index,
      y,
      ts: 1_000 + index * 90
    }));

    expect(feed(detector, samples)).toBe(false);
  });

  it("activates when buttons field is set (buttons field is ignored by detector)", () => {
    const detector = new ShakeDetector();

    // Swift only taps .mouseMoved — the buttons field is never populated in production.
    // The detector does not use it; a valid shake pattern activates regardless.
    expect(feed(detector, verticalShake(1_000, { buttons: 1 }))).toBe(true);
  });

  it("tolerates some horizontal drift", () => {
    const detector = new ShakeDetector();

    expect(feed(detector, verticalShake(1_000, { xDrift: 100 }))).toBe(true);
  });

  it("rejects mostly horizontal movement", () => {
    const detector = new ShakeDetector();

    expect(feed(detector, verticalShake(1_000, { xDrift: 240 }))).toBe(false);
  });

  it("maps sensitivity presets to detector config thresholds", () => {
    expect(getShakeDetectorConfigForSensitivity("relaxed")).toMatchObject({
      minReversals: 4,
      minAmplitudePx: 70,
      minVerticalTravelPx: 320
    });
    expect(getShakeDetectorConfigForSensitivity("normal")).toMatchObject({
      minReversals: 5,
      minAmplitudePx: 90,
      minVerticalTravelPx: 420
    });
    expect(getShakeDetectorConfigForSensitivity("strict")).toMatchObject({
      minReversals: 6,
      minAmplitudePx: 120,
      minVerticalTravelPx: 520
    });
  });
});
