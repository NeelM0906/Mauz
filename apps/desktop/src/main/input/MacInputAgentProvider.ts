import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, join, resolve } from "node:path";
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

type SpawnLike = (command: string, args?: readonly string[]) => ChildProcessLike;

type ShakeDetectorLike = {
  push(sample: { x: number; y: number; ts: number; buttons?: number | undefined }): ShakeDetectorResult;
  reset(): void;
};

export type MacInputAgentProviderOptions = {
  helperPath?: string;
  helperAppPath?: string;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
  spawn?: SpawnLike;
  detector?: ShakeDetectorLike;
  maxRestarts?: number;
  restartDelayMs?: number;
};

const ACCESSIBILITY_PERMISSION_MESSAGE =
  "Mauz needs Accessibility permission to detect the mouse shake. Open System Settings -> Privacy & Security -> Accessibility, then enable MauzInputAgent.";
const HELPER_NOT_FOUND_MESSAGE =
  "Mauz native input helper is not built. Run native/macos/MauzInputAgent/build.sh, then restart Mauz.";
const DEFAULT_MAX_RESTARTS = 2;
const DEFAULT_RESTART_DELAY_MS = 750;

export class MacInputAgentProvider implements InputProvider {
  private readonly activationListeners = new Set<(event: ActivationEvent) => void>();
  private readonly permissionListeners = new Set<(error: PermissionError) => void>();
  private readonly detector: ShakeDetectorLike;
  private readonly maxRestarts: number;
  private readonly restartDelayMs: number;
  private readonly pathExists: (path: string) => boolean;
  private readonly spawnHelper: SpawnLike;
  private readonly platform: NodeJS.Platform;
  private child: ChildProcessLike | null = null;
  private stdoutBuffer = "";
  private readonly decoder = new StringDecoder("utf8");
  private socketServer: Server | null = null;
  private socket: Socket | null = null;
  private socketPath: string | null = null;
  private stopping = false;
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private permissionFailure = false;

  constructor(options: MacInputAgentProviderOptions = {}) {
    this.detector = options.detector ?? new ShakeDetector();
    this.maxRestarts = options.maxRestarts ?? DEFAULT_MAX_RESTARTS;
    this.restartDelayMs = options.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS;
    this.pathExists = options.pathExists ?? existsSync;
    this.spawnHelper = options.spawn ?? ((command, args) => spawn(command, args ?? []));
    this.platform = options.platform ?? process.platform;
    this.helperPath = options.helperPath ?? findDefaultHelperPath();
    this.helperAppPath = options.helperAppPath ?? getAppBundlePathForExecutable(this.helperPath);
  }

  private readonly helperPath: string;
  private readonly helperAppPath: string | undefined;

  start(): void {
    if (this.child !== null || this.socketServer !== null || this.restartTimer !== null) {
      return;
    }

    this.stopping = false;
    this.permissionFailure = false;

    if (this.platform !== "darwin") {
      this.emitPermissionError({
        permission: "unknown",
        message: "Native mouse shake is only available on macOS."
      });
      return;
    }

    const launchPath = this.getLaunchPath();

    if (!this.pathExists(launchPath)) {
      this.emitPermissionError({
        permission: "unknown",
        message: HELPER_NOT_FOUND_MESSAGE
      });
      return;
    }

    if (this.shouldLaunchAppBundle()) {
      this.startAppBundleChild();
    } else {
      this.startExecutableChild();
    }
  }

  stop(): void {
    this.stopping = true;

    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.child;
    this.child = null;
    this.closeSocketServer();
    this.stdoutBuffer = "";
    this.decoder.end();
    this.detector.reset();

    if (child !== null && child.killed !== true) {
      child.kill("SIGTERM");
    }

    this.stopHelperApp();
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

  private startExecutableChild(): void {
    const child = this.spawnHelper(this.helperPath, []);
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
      this.scheduleRestartIfNeeded();
    });
  }

  private startAppBundleChild(): void {
    const helperAppPath = this.helperAppPath;

    if (helperAppPath === undefined) {
      this.startExecutableChild();
      return;
    }

    const socketPath = join("/tmp", `mauz-input-${process.pid}-${randomUUID()}.sock`);
    const server = createServer((socket) => {
      this.socket?.destroy();
      this.socket = socket;

      socket.on("data", (chunk: Buffer | string) => {
        this.handleStdout(chunk);
      });
      socket.once("close", () => {
        if (this.socket === socket) {
          this.socket = null;
        }
      });
    });

    this.socketPath = socketPath;
    this.socketServer = server;

    server.once("error", (error) => {
      this.closeSocketServer();
      this.emitPermissionError({
        permission: "unknown",
        message: `Mauz could not start the native input helper socket: ${error.message}`
      });
    });

    server.listen(socketPath, () => {
      if (this.stopping || this.socketServer !== server) {
        this.closeSocketServer();
        return;
      }

      const child = this.spawnHelper("/usr/bin/open", ["-n", "-W", helperAppPath, "--args", "--socket", socketPath]);
      this.child = child;

      child.stderr?.on("data", () => {
        // Intentionally discard helper stderr so screenshot or selected text data can never leak into logs.
      });
      child.once("error", (error) => {
        if (this.child === child) {
          this.child = null;
        }
        this.closeSocketServer();
        this.emitPermissionError({
          permission: "unknown",
          message: `Mauz could not start the native input helper: ${error.message}`
        });
      });
      child.once("exit", () => {
        if (this.child === child) {
          this.child = null;
        }

        this.closeSocketServer();

        if (this.stopping) {
          return;
        }

        this.flushStdout();
        this.scheduleRestartIfNeeded();
      });
    });
  }

  private getLaunchPath(): string {
    return this.shouldLaunchAppBundle() ? this.helperAppPath! : this.helperPath;
  }

  private shouldLaunchAppBundle(): boolean {
    return this.helperAppPath !== undefined;
  }

  private closeSocketServer(): void {
    this.socket?.destroy();
    this.socket = null;

    this.socketServer?.close();
    this.socketServer = null;

    if (this.socketPath !== null) {
      try {
        unlinkSync(this.socketPath);
      } catch {
        // The socket path may already be gone if the server never finished binding.
      }

      this.socketPath = null;
    }
  }

  private stopHelperApp(): void {
    if (this.helperAppPath === undefined) {
      return;
    }

    const helperExecutablePath = join(this.helperAppPath, "Contents/MacOS/MauzInputAgent");
    const stopper = this.spawnHelper("/usr/bin/pkill", ["-f", helperExecutablePath]);
    stopper.stdout?.resume();
    stopper.stderr?.resume();
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
      return;
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
  if (process.env.MAUZ_INPUT_AGENT_PATH !== undefined && process.env.MAUZ_INPUT_AGENT_PATH.length > 0) {
    return process.env.MAUZ_INPUT_AGENT_PATH;
  }

  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
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

function getAppBundlePathForExecutable(executablePath: string): string | undefined {
  const marker = ".app/Contents/MacOS/";
  const markerIndex = executablePath.indexOf(marker);

  if (markerIndex < 0) {
    return undefined;
  }

  return executablePath.slice(0, markerIndex + ".app".length);
}
