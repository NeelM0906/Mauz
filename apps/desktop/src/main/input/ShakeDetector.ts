import type { MouseMoveSample } from "@mauzai/shared";

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

    const first = this.samples[0]!;
    let minX = first.x;
    let maxX = first.x;
    let minY = first.y;
    let maxY = first.y;
    let verticalTravel = 0;
    let reversals = 0;
    let lastDirection = 0;

    for (let i = 1; i < this.samples.length; i += 1) {
      const previous = this.samples[i - 1]!;
      const current = this.samples[i]!;
      const dy = current.y - previous.y;

      minX = Math.min(minX, current.x);
      maxX = Math.max(maxX, current.x);
      minY = Math.min(minY, current.y);
      maxY = Math.max(maxY, current.y);
      verticalTravel += Math.abs(dy);

      if (Math.abs(dy) >= this.config.minDirectionDeltaPx) {
        const direction = Math.sign(dy);

        if (lastDirection !== 0 && direction !== lastDirection) {
          reversals += 1;
        }

        lastDirection = direction;
      }
    }

    const verticalAmplitude = maxY - minY;
    const horizontalRange = maxX - minX;
    const horizontalToVerticalRatio = horizontalRange / Math.max(verticalAmplitude, 1);

    if (verticalAmplitude < this.config.minAmplitudePx) {
      return { activated: false, reason: "amplitude" };
    }

    if (verticalTravel < this.config.minVerticalTravelPx) {
      return { activated: false, reason: "travel" };
    }

    if (reversals < this.config.minReversals) {
      return { activated: false, reason: "reversals" };
    }

    if (horizontalToVerticalRatio > this.config.maxHorizontalToVerticalRatio) {
      return { activated: false, reason: "horizontal-drift" };
    }

    return { activated: true };
  }
}
