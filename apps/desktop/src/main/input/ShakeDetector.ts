import type { MouseMoveSample, ShakeSensitivity } from "@mauzai/shared";

export type ShakeDetectorConfig = {
  windowMs: number;
  minReversals: number;
  minAmplitudePx: number;
  minVerticalTravelPx: number;
  minDirectionDeltaPx: number;
  cooldownMs: number;
  maxHorizontalToVerticalRatio: number;
};

export type ShakeDetectorResult = {
  activated: boolean;
  reason?: string;
};

export const DEFAULT_SHAKE_CONFIG: ShakeDetectorConfig = {
  windowMs: 1200,
  minReversals: 5,
  minAmplitudePx: 90,
  minVerticalTravelPx: 420,
  minDirectionDeltaPx: 8,
  cooldownMs: 2500,
  maxHorizontalToVerticalRatio: 1.25
};

export const SHAKE_SENSITIVITY_PRESETS = {
  relaxed: {
    minReversals: 4,
    minAmplitudePx: 70,
    minVerticalTravelPx: 320
  },
  normal: {
    minReversals: 5,
    minAmplitudePx: 90,
    minVerticalTravelPx: 420
  },
  strict: {
    minReversals: 6,
    minAmplitudePx: 120,
    minVerticalTravelPx: 520
  }
} as const satisfies Record<ShakeSensitivity, Partial<ShakeDetectorConfig>>;

export function getShakeDetectorConfigForSensitivity(sensitivity: ShakeSensitivity): ShakeDetectorConfig {
  return {
    ...DEFAULT_SHAKE_CONFIG,
    ...SHAKE_SENSITIVITY_PRESETS[sensitivity]
  };
}

export class ShakeDetector {
  private readonly config: ShakeDetectorConfig;
  private samples: MouseMoveSample[] = [];
  private lastActivationAt = Number.NEGATIVE_INFINITY;

  constructor(config: Partial<ShakeDetectorConfig> = {}) {
    this.config = { ...DEFAULT_SHAKE_CONFIG, ...config };
  }

  push(sample: MouseMoveSample): ShakeDetectorResult {
    if ((sample.buttons ?? 0) !== 0) {
      this.reset();
      return { activated: false, reason: "button-held" };
    }

    if (sample.ts - this.lastActivationAt < this.config.cooldownMs) {
      return { activated: false, reason: "cooldown" };
    }

    this.samples.push(sample);
    this.trimWindow(sample.ts);

    const result = this.evaluate();

    if (result.activated) {
      this.lastActivationAt = sample.ts;
      this.samples = [];
    }

    return result;
  }

  reset(): void {
    this.samples = [];
  }

  private trimWindow(now: number): void {
    const minTs = now - this.config.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.ts < minTs) {
      this.samples.shift();
    }
  }

  private evaluate(): ShakeDetectorResult {
    if (this.samples.length < 3) {
      return { activated: false, reason: "insufficient-samples" };
    }

    const verticalResult = this.evaluateAxis("y", "x");
    const horizontalResult = this.evaluateAxis("x", "y");

    if (verticalResult.activated || horizontalResult.activated) {
      return { activated: true };
    }

    return verticalResult.primaryAmplitude >= horizontalResult.primaryAmplitude
      ? verticalResult
      : horizontalResult;
  }

  private evaluateAxis(
    primaryAxis: "x" | "y",
    crossAxis: "x" | "y"
  ): ShakeDetectorResult & { primaryAmplitude: number } {
    const first = this.samples[0]!;
    let minPrimary = first[primaryAxis];
    let maxPrimary = first[primaryAxis];
    let minCross = first[crossAxis];
    let maxCross = first[crossAxis];
    let primaryTravel = 0;
    let reversals = 0;
    let lastDirection = 0;

    for (let i = 1; i < this.samples.length; i += 1) {
      const previous = this.samples[i - 1]!;
      const current = this.samples[i]!;
      const primaryDelta = current[primaryAxis] - previous[primaryAxis];

      minPrimary = Math.min(minPrimary, current[primaryAxis]);
      maxPrimary = Math.max(maxPrimary, current[primaryAxis]);
      minCross = Math.min(minCross, current[crossAxis]);
      maxCross = Math.max(maxCross, current[crossAxis]);
      primaryTravel += Math.abs(primaryDelta);

      if (Math.abs(primaryDelta) >= this.config.minDirectionDeltaPx) {
        const direction = Math.sign(primaryDelta);

        if (lastDirection !== 0 && direction !== lastDirection) {
          reversals += 1;
        }

        lastDirection = direction;
      }
    }

    const primaryAmplitude = maxPrimary - minPrimary;
    const crossAmplitude = maxCross - minCross;
    const crossToPrimaryRatio = crossAmplitude / Math.max(primaryAmplitude, 1);

    if (primaryAmplitude < this.config.minAmplitudePx) {
      return { activated: false, reason: "amplitude", primaryAmplitude };
    }

    if (primaryTravel < this.config.minVerticalTravelPx) {
      return { activated: false, reason: "travel", primaryAmplitude };
    }

    if (reversals < this.config.minReversals) {
      return { activated: false, reason: "reversals", primaryAmplitude };
    }

    if (crossToPrimaryRatio > this.config.maxHorizontalToVerticalRatio) {
      return { activated: false, reason: "cross-axis-drift", primaryAmplitude };
    }

    return { activated: true, primaryAmplitude };
  }
}
