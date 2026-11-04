import type { PermissionError } from "@mauzai/shared";
import type { ActivationEvent, InputProvider, Unsubscribe } from "./InputProvider";
import { ShakeDetector, type ShakeDetectorResult } from "./ShakeDetector";

type Point = {
  x: number;
  y: number;
};

type ShakeDetectorLike = {
  push(sample: { x: number; y: number; ts: number }): ShakeDetectorResult;
  reset(): void;
};

export type CursorPollingInputProviderOptions = {
  readCursor: () => Point;
  detector?: ShakeDetectorLike;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Poll rate while the pointer is moving; a shake needs dense samples. */
  activeIntervalMs?: number;
  /** Poll rate once the pointer has been still for `idleAfterMs`, to save power. */
  idleIntervalMs?: number;
  idleAfterMs?: number;
};

const DEFAULT_ACTIVE_INTERVAL_MS = 16;
const DEFAULT_IDLE_INTERVAL_MS = 50;
const DEFAULT_IDLE_AFTER_MS = 1_500;

/**
 * Mouse-shake activation by sampling the cursor position. Needs no native helper and no
 * OS permission, so it is the shake source on Windows and Linux.
 */
export class CursorPollingInputProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private readonly permissionListeners = new Set<(error: PermissionError) => void>();
  private readonly readCursor: () => Point;
  private readonly detector: ShakeDetectorLike;
  private readonly now: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly activeIntervalMs: number;
  private readonly idleIntervalMs: number;
  private readonly idleAfterMs: number;
  private timer: unknown = null;
  private lastPoint: Point | null = null;
  private lastMovedAt = Number.NEGATIVE_INFINITY;

  constructor(options: CursorPollingInputProviderOptions) {
    this.readCursor = options.readCursor;
    this.detector = options.detector ?? new ShakeDetector();
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
    this.activeIntervalMs = options.activeIntervalMs ?? DEFAULT_ACTIVE_INTERVAL_MS;
    this.idleIntervalMs = options.idleIntervalMs ?? DEFAULT_IDLE_INTERVAL_MS;
    this.idleAfterMs = options.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
  }

  start(): void {
    if (this.timer !== null) {
      return;
    }

    this.lastPoint = null;
    this.timer = this.schedule(() => this.tick(), this.idleIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }

    this.lastPoint = null;
    this.detector.reset();
  }

  onActivation(callback: (event: ActivationEvent) => void): Unsubscribe {
    this.activationListeners.add(callback);
    return () => {
      this.activationListeners.delete(callback);
    };
  }

  onPermissionError(callback: (error: PermissionError) => void): Unsubscribe {
    this.permissionListeners.add(callback);
    return () => {
      this.permissionListeners.delete(callback);
    };
  }

  private tick(): void {
    const ts = this.now();

    try {
      this.sample(ts);
    } catch {
      // A transient cursor read failure (for example during a display change) skips one sample.
    }

    if (this.timer === null) {
      return;
    }

    const recentlyMoved = ts - this.lastMovedAt < this.idleAfterMs;
    this.timer = this.schedule(
      () => this.tick(),
      recentlyMoved ? this.activeIntervalMs : this.idleIntervalMs
    );
  }

  private sample(ts: number): void {
    const point = this.readCursor();
    const previous = this.lastPoint;
    this.lastPoint = point;

    if (previous === null || (previous.x === point.x && previous.y === point.y)) {
      return;
    }

    this.lastMovedAt = ts;
    const result = this.detector.push({ x: point.x, y: point.y, ts });

    if (result.activated) {
      for (const listener of this.activationListeners) {
        listener({ source: "mouse-shake", cursor: { x: point.x, y: point.y } });
      }
    }
  }
}
