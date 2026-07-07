import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import { MacInputAgentEventSchema, type PermissionError } from "@mauzai/shared";
import type { Readable } from "node:stream";
import type { ActivationEvent, InputProvider, Unsubscribe } from "./InputProvider";
import { ShakeDetector, type ShakeDetectorResult } from "./ShakeDetector";

type ChildProcessLike = {
  stdout: Readable | null;
  stderr?: Readable | null;
  killed?: boolean;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

type SpawnLike = (command: string, args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => ChildProcessLike;

type ShakeDetectorLike = {
  push(sample: { x: number; y: number; ts: number; buttons?: number | undefined }): ShakeDetectorResult;
  reset(): void;
};

export type MacInputAgentProviderOptions = {
  helperPath?: string;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
  spawn?: SpawnLike;
  detector?: ShakeDetectorLike;
  maxRestarts?: number;
  restartDelayMs?: number;
  permissionRetryDelayMs?: number;
};

const ACCESSIBILITY_PERMISSION_MESSAGE =
  "Mauz needs Accessibility permission to detect the mouse shake. Open System Settings -> Privacy & Security -> Accessibility, then enable MauzInputAgent.";
const HELPER_NOT_FOUND_MESSAGE =
  "Mauz native input helper is not built. Run native/macos/MauzInputAgent/build.sh, then restart Mauz.";
const DEFAULT_MAX_RESTARTS = 2;
const DEFAULT_RESTART_DELAY_MS = 750;
const DEFAULT_PERMISSION_RETRY_DELAY_MS = 15_000;

export class MacInputAgentProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private readonly permissionListeners = new Set<(error: PermissionError) => void>();
  private readonly detector: ShakeDetectorLike;
  private readonly maxRestarts: number;
  private readonly restartDelayMs: number;
  private readonly permissionRetryDelayMs: number;
  private readonly pathExists: (path: string) => boolean;
  private readonly spawnHelper: SpawnLike;
  private readonly platform: NodeJS.Platform;
  private child: ChildProcessLike | null = null;
  private stdoutBuffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private stopping = false;
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private permissionFailure = false;
  private permissionRetryTimer: NodeJS.Timeout | null = null;

  constructor(options: MacInputAgentProviderOptions = {}) {
    this.detector = options.detector ?? new ShakeDetector();
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
    this.permissionRetryDelayMs = options.permissionRetryDelayMs ?? DEFAULT_PERMISSION_RETRY_DELAY_MS;
    this.pathExists = options.pathExists ?? existsSync;
    this.spawnHelper =
      options.spawn ??
      ((command, args, opts) =>
        spawn(command, args ?? [], opts?.env !== undefined ? { env: opts.env } : {}));
    this.platform = options.platform ?? process.platform;
    this.helperPath = options.helperPath ?? findDefaultHelperPath();
  }

  private readonly helperPath: string;

  start(): void {
    if (this.child !== null || this.restartTimer !== null) {
      return;
    }

    this.stopping = false;
    this.permissionFailure = false;

    // Cancel any pending permission retry so a fresh start takes effect immediately.
    if (this.permissionRetryTimer !== null) {
      clearTimeout(this.permissionRetryTimer);
      this.permissionRetryTimer = null;
    }

    if (this.platform !== "darwin") {
      this.emitPermissionError({
        permission: "unknown",
        message: "Native mouse shake is only available on macOS."
      });
      return;
    }

    if (!this.pathExists(this.helperPath)) {
      this.emitPermissionError({
        permission: "unknown",
        message: HELPER_NOT_FOUND_MESSAGE
      });
      return;
    }

    this.startExecutableChild();
  }

  stop(): void {
    this.stopping = true;

    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.permissionRetryTimer !== null) {
      clearTimeout(this.permissionRetryTimer);
      this.permissionRetryTimer = null;
    }

    const child = this.child;
    this.child = null;
    this.stdoutBuffer = "";
    this.decoder.end();
    this.detector.reset();

    if (child !== null && child.killed !== true) {
      child.kill("SIGTERM");
    }
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

  private startExecutableChild(env?: NodeJS.ProcessEnv): void {
    const child = this.spawnHelper(this.helperPath, [], env !== undefined ? { env } : undefined);
    this.child = child;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.handleStdout(chunk);
    });
    child.stderr?.on("data", () => {
      // Intentionally discard helper stderr so screenshot or selected text data can never leak into logs.
    });
    child.once("error", (error) => {
      if (this.child === child) {
        this.child = null;
      }
      this.emitPermissionError({
        permission: "unknown",
        message: `Mauz could not start the native input helper: ${error.message}`
      });
    });
    child.once("exit", () => {
      if (this.child === child) {
        this.child = null;
      }

      if (this.stopping) {
        return;
      }

      this.flushStdout();

      if (this.permissionFailure) {
        // Normal restart is blocked in permission-failure state; use the retry timer instead.
        this.schedulePermissionRetry();
      } else {
        this.scheduleRestartIfNeeded();
      }
    });
  }

  private handleStdout(chunk: Buffer | string): void {
    this.stdoutBuffer += this.decoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk);

    let newlineIndex = this.stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      this.handleLine(line);
      newlineIndex = this.stdoutBuffer.indexOf("\n");
    }
  }

  private flushStdout(): void {
    this.stdoutBuffer += this.decoder.end();
    const line = this.stdoutBuffer.trim();
    this.stdoutBuffer = "";

    if (line.length > 0) {
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    if (line.length === 0) {
      return;
    }

    const parsedJson = parseJson(line);
    if (parsedJson === undefined) {
      return;
    }

    const parsedEvent = MacInputAgentEventSchema.safeParse(parsedJson);
    if (!parsedEvent.success) {
      return;
    }

    if (parsedEvent.data.type === "permission_error") {
      this.permissionFailure = true;
      this.emitPermissionError({
        permission: parsedEvent.data.permission,
        message: parsedEvent.data.message || ACCESSIBILITY_PERMISSION_MESSAGE
      });
      this.schedulePermissionRetry();
      return;
    }

    // Fix 2: Reset restart budget on the first valid sample so two crashes hours apart
    // don't permanently exhaust the lifetime cap.
    if (this.restartAttempts > 0) {
      this.restartAttempts = 0;
    }

    // Fix 3: Clear permission-failure state when a valid sample arrives — the user
    // must have granted Accessibility while we were retrying.
    if (this.permissionFailure) {
      this.permissionFailure = false;
      if (this.permissionRetryTimer !== null) {
        clearTimeout(this.permissionRetryTimer);
        this.permissionRetryTimer = null;
      }
    }

    const result = this.detector.push({
      x: parsedEvent.data.x,
      y: parsedEvent.data.y,
      ts: parsedEvent.data.ts
    });

    if (result.activated) {
      this.emitActivation({
        source: "mouse-shake",
        cursor: {
          x: parsedEvent.data.x,
          y: parsedEvent.data.y
        }
      });
    }
  }

  private scheduleRestartIfNeeded(): void {
    if (this.stopping || this.permissionFailure || this.restartAttempts >= this.maxRestarts) {
      return;
    }

    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.start();
    }, this.restartDelayMs);
  }

  // Fix 3: Retry spawning every permissionRetryDelayMs while in permission-failure state.
  // Uses MAUZ_AX_PROMPT=0 so the user is not repeatedly prompted — they already saw the
  // prompt on first launch; the retry is purely to pick up a newly granted permission.
  private schedulePermissionRetry(): void {
    if (this.stopping || this.permissionRetryTimer !== null) {
      return;
    }

    this.permissionRetryTimer = setTimeout(() => {
      this.permissionRetryTimer = null;
      if (!this.stopping && this.permissionFailure) {
        this.startExecutableChild({ ...process.env, MAUZ_AX_PROMPT: "0" });
      }
    }, this.permissionRetryDelayMs);
  }

  private emitActivation(event: ActivationEvent): void {
    for (const listener of this.activationListeners) {
      listener(event);
    }
  }

  private emitPermissionError(error: PermissionError): void {
    for (const listener of this.permissionListeners) {
      listener(error);
    }
  }
}

function parseJson(line: string): unknown | undefined {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }
}

function findDefaultHelperPath(): string {
  const configuredHelperPath = process.env.MAUZ_INPUT_AGENT_PATH?.trim();

  if (configuredHelperPath && existsSync(configuredHelperPath)) {
    return configuredHelperPath;
  }

  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(
      dirname(process.execPath),
      "../Resources/app/native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(dirname(process.execPath), "../Resources/app/native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      process.resourcesPath,
      "app/native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(process.resourcesPath, "app/native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(process.cwd(), "native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"),
    resolve(process.cwd(), "native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      process.cwd(),
      "../../native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(process.cwd(), "../../native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      currentFileDir,
      "../../../../native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(currentFileDir, "../../../../native/macos/MauzInputAgent/MauzInputAgent"),
    resolve(
      currentFileDir,
      "../../../../../native/macos/MauzInputAgent/MauzInputAgent.app/Contents/MacOS/MauzInputAgent"
    ),
    resolve(currentFileDir, "../../../../../native/macos/MauzInputAgent/MauzInputAgent")
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

