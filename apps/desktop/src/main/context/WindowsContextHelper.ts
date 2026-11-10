import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { Bounds, PointerTarget, PointerTargetElement, ScreenshotPayload } from "@mauzai/shared";
import { BOOTSTRAP_SCRIPT, HELPER_SCRIPT } from "./windowsHelperScript";

type ChildProcessLike = {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

export type WindowsContextSpawn = (command: string, args: readonly string[]) => ChildProcessLike;

type Point = { x: number; y: number };

/**
 * The helper is per-monitor DPI aware and works in physical pixels; the rest of Mauz uses
 * Electron DIPs. These convert at the boundary (Electron's screen.dipToScreenPoint and
 * screen.screenToDipRect on Windows). Identity by default.
 */
export type WindowsCoordinateConverter = {
  toPhysicalPoint(point: Point): Point;
  toDipRect(rect: Bounds): Bounds;
};

const identityConverter: WindowsCoordinateConverter = {
  toPhysicalPoint: (point) => point,
  toDipRect: (rect) => rect
};

type WindowsActiveWindow = {
  title?: string | undefined;
  processName?: string | undefined;
  executable?: string | undefined;
  processId?: number | undefined;
  bounds?: { x: number; y: number; width: number; height: number } | undefined;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const DEFAULT_TIMEOUT_MS = 900;
// PowerShell and its assemblies load in a few seconds; requests wait this long for the helper
// to say it is ready. Request timeouts start only once it is.
const STARTUP_WAIT_MS = 3_000;
// Includes queueing behind the activation's window and selection lookups.
const ELEMENT_AT_POINT_TIMEOUT_MS = 1_500;
// The first OCR request also loads the WinRT engine.
const OCR_TIMEOUT_MS = 4_000;
const MAX_OCR_IMAGE_BASE64_CHARS = 1_500_000;
const MAX_WINDOW_TEXT_CHARS = 500;
const MAX_TARGET_VALUE_CHARS = 2_000;
const MAX_TARGET_TEXT_CHARS = 4_000;
const MAX_ROLE_CHARS = 80;
const TRANSCRIBE_TIMEOUT_MS = 30_000;
const MAX_SELECTED_TEXT_CHARS = 8_000;

/**
 * A long-lived PowerShell process that answers context questions about the foreground
 * window: Win32 for the window and owning process, UI Automation for selected text and
 * the element under the pointer.
 * PowerShell and UIA ship with Windows, so this needs no extra install, and keeping the
 * process alive avoids PowerShell's startup cost on every activation.
 */
export class WindowsContextHelper {
  private readonly spawnHelper: WindowsContextSpawn;
  private readonly coordinates: WindowsCoordinateConverter;
  private child: ChildProcessLike | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private ready = false;
  private readyWaiters: Array<() => void> = [];

  constructor(options: { spawn?: WindowsContextSpawn; coordinates?: WindowsCoordinateConverter } = {}) {
    this.coordinates = options.coordinates ?? identityConverter;
    this.spawnHelper =
      options.spawn ??
      ((command, args) =>
        spawn(command, [...args], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        }));
  }

  start(): void {
    if (this.child !== null) {
      return;
    }

    const child = this.spawnHelper(getPowerShellPath(), [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(BOOTSTRAP_SCRIPT, "utf16le").toString("base64")
    ]);
    this.child = child;
    // The helper is longer than Windows allows on a command line, so it arrives as the first stdin line.
    child.stdin?.write(`${Buffer.from(HELPER_SCRIPT, "utf8").toString("base64")}\n`);

    const decoder = new StringDecoder("utf8");
    let buffer = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      let newlineIndex = buffer.indexOf("\n");

      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        this.handleLine(line);
        newlineIndex = buffer.indexOf("\n");
      }
    });
    child.stderr?.on("data", () => {
      // Intentionally ignored: stderr could contain window titles or selected text.
    });
    child.stdin?.on("error", () => {
      // The exit handler fails pending requests.
    });
    child.once("error", () => this.handleExit(child));
    child.once("exit", () => this.handleExit(child));
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    this.setReady(false);
    this.failPending(new Error("Windows context helper stopped."));

    if (child !== null) {
      try {
        child.kill();
      } catch {
        // Already exited.
      }
    }
  }

  async getActiveWindow(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<WindowsActiveWindow> {
    const result = await this.request("activeWindow", timeoutMs);

    if (!isRecord(result)) {
      return {};
    }

    const window = parseActiveWindow(result);

    if (window.bounds !== undefined) {
      window.bounds = this.coordinates.toDipRect(window.bounds);
    }

    return window;
  }

  /**
   * The UI element under a screen point (DIPs): its text, the group around it, and the
   * window it belongs to. Password fields are never read.
   */
  async getElementAtPoint(
    point: Point,
    options: { excludeProcessId?: number | undefined; timeoutMs?: number | undefined } = {}
  ): Promise<PointerTarget | undefined> {
    const physical = this.coordinates.toPhysicalPoint(point);
    const result = await this.request("elementAtPoint", options.timeoutMs ?? ELEMENT_AT_POINT_TIMEOUT_MS, {
      x: String(Math.round(physical.x)),
      y: String(Math.round(physical.y)),
      // Mauz's own windows (the popover) are looked through to the app behind them.
      exclude: String(options.excludeProcessId ?? 0)
    });

    return isRecord(result)
      ? parseElementAtPoint(result, (rect) => this.coordinates.toDipRect(rect))
      : undefined;
  }

  async getSelectedText(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | undefined> {
    const result = await this.request("selectedText", timeoutMs);

    if (typeof result !== "string") {
      return undefined;
    }

    const trimmed = result.trim();

    return trimmed.length === 0 ? undefined : trimmed.slice(0, MAX_SELECTED_TEXT_CHARS);
  }

  /**
   * Windows only lets the app that received the last input take the foreground, and a
   * mouse shake is delivered to the app under the cursor. This hands keyboard focus to a
   * Mauz window so typing, Escape, and click-outside-to-close work right after a shake.
   */
  async focusWindow(handle: bigint, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    const result = await this.request("focusWindow", timeoutMs, { handle: handle.toString() });

    return result === true;
  }

  /**
   * Offline speech-to-text with the Windows desktop speech recognizer (System.Speech
   * dictation). Expects a 16 kHz mono 16-bit PCM WAV file.
   */
  async transcribeWav(path: string, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Promise<string> {
    const result = await this.request("transcribe", timeoutMs, { path });

    return typeof result === "string" ? result.trim() : "";
  }

  /**
   * Text in an image, from the built-in Windows OCR engine. For apps that expose no text to UI
   * Automation (canvas apps, images, some terminals).
   */
  async recognizeText(image: ScreenshotPayload, timeoutMs = OCR_TIMEOUT_MS): Promise<string | undefined> {
    // Windows PowerShell's JSON reader rejects very long lines.
    if (image.base64.length > MAX_OCR_IMAGE_BASE64_CHARS) {
      return undefined;
    }

    // OCR is bounded inside the helper; restarting would throw away the loaded engine.
    const result = await this.request("ocr", timeoutMs, { image: image.base64 }, { restartOnTimeout: false });

    return readText(result, MAX_TARGET_TEXT_CHARS);
  }

  private async request(
    command: "activeWindow" | "selectedText" | "elementAtPoint" | "ocr" | "focusWindow" | "transcribe",
    timeoutMs: number,
    parameters: Record<string, string> = {},
    options: { restartOnTimeout?: boolean } = {}
  ): Promise<unknown> {
    this.start();

    if (!(await this.waitUntilReady())) {
      // Still starting: fail without restarting it, which would only start over.
      throw new Error("Windows context helper is still starting.");
    }

    const child = this.child;

    if (child?.stdin === null || child === null) {
      return Promise.reject(new Error("Windows context helper is not running."));
    }

    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);

        // A UIA call into a hung app can block the helper; restart it so later requests work.
        if (options.restartOnTimeout !== false) {
          this.restart();
        }

        reject(new Error(`Windows context helper timed out on ${command}.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      child.stdin?.write(`${JSON.stringify({ id, command, ...parameters })}\n`);
    });
  }

  private handleLine(line: string): void {
    if (line.length === 0) {
      return;
    }

    let response: unknown;

    try {
      response = JSON.parse(line);
    } catch {
      return;
    }

    if (isRecord(response) && response.ready === true) {
      this.setReady(true);
      return;
    }

    if (!isRecord(response) || typeof response.id !== "number") {
      return;
    }

    const pending = this.pending.get(response.id);

    if (pending === undefined) {
      return;
    }

    this.pending.delete(response.id);
    clearTimeout(pending.timer);

    if (typeof response.error === "string") {
      pending.reject(new Error(response.error));
      return;
    }

    pending.resolve(response.result);
  }

  private handleExit(child: ChildProcessLike): void {
    if (this.child === child) {
      this.child = null;
      this.setReady(false);
    }

    this.failPending(new Error("Windows context helper exited."));
  }

  private waitUntilReady(): Promise<boolean> {
    if (this.ready) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.readyWaiters = this.readyWaiters.filter((waiter) => waiter !== done);
        resolve(false);
      }, STARTUP_WAIT_MS);
      const done = () => {
        clearTimeout(timer);
        resolve(this.ready);
      };

      this.readyWaiters.push(done);
    });
  }

  private setReady(ready: boolean): void {
    this.ready = ready;

    if (ready) {
      const waiters = this.readyWaiters;
      this.readyWaiters = [];
      waiters.forEach((waiter) => waiter());
    }
  }

  private restart(): void {
    this.stop();
    this.start();
  }

  private failPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function parseElementAtPoint(
  result: Record<string, unknown>,
  toDipRect: (rect: Bounds) => Bounds
): PointerTarget | undefined {
  const targetWindow: NonNullable<PointerTarget["window"]> = {};

  if (isRecord(result.window)) {
    const window = parseActiveWindow(result.window);

    if (window.title !== undefined) targetWindow.title = window.title;
    if (window.processName !== undefined) targetWindow.appName = window.processName;
    if (window.executable !== undefined) targetWindow.executable = window.executable;
    if (window.processId !== undefined) targetWindow.processId = window.processId;
    if (window.bounds !== undefined) targetWindow.bounds = toDipRect(window.bounds);
  }

  const hasWindow = Object.keys(targetWindow).length > 0;
  // With no element (UIA found nothing), the window alone still says which app is there.
  const element =
    (isRecord(result.element) ? parseTargetElement(result.element, toDipRect) : undefined) ??
    (hasWindow
      ? {
          role: "Window",
          ...(targetWindow.title === undefined ? {} : { name: targetWindow.title }),
          ...(targetWindow.bounds === undefined ? {} : { bounds: targetWindow.bounds })
        }
      : undefined);

  if (element === undefined) {
    return undefined;
  }

  const target: PointerTarget = { source: "windows-uia", element };
  const container = isRecord(result.container) ? parseTargetElement(result.container, toDipRect) : undefined;

  if (container !== undefined) {
    target.container = container;
  }

  if (hasWindow) {
    target.window = targetWindow;
  }

  return target;
}

function parseTargetElement(
  value: Record<string, unknown>,
  toDipRect: (rect: Bounds) => Bounds
): PointerTargetElement | undefined {
  const role = readText(value.role, MAX_ROLE_CHARS);

  if (role === undefined) {
    return undefined;
  }

  const element: PointerTargetElement = { role };
  const name = readText(value.name, MAX_WINDOW_TEXT_CHARS);
  const elementValue = readText(value.value, MAX_TARGET_VALUE_CHARS);
  const text = readText(value.text, MAX_TARGET_TEXT_CHARS);
  const bounds = parseBounds(value.bounds);

  if (name !== undefined) element.name = name;
  if (elementValue !== undefined) element.value = elementValue;
  if (text !== undefined) element.text = text;
  if (bounds !== undefined && bounds.width > 0 && bounds.height > 0) element.bounds = toDipRect(bounds);

  return element;
}

function readText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length === 0 ? undefined : trimmed.slice(0, maxLength);
}

function parseBounds(value: unknown): Bounds | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { x, y, width, height } = value;

  if (![x, y, width, height].every((part) => typeof part === "number" && Number.isFinite(part))) {
    return undefined;
  }

  return {
    x: x as number,
    y: y as number,
    width: Math.max(0, width as number),
    height: Math.max(0, height as number)
  };
}

function parseActiveWindow(result: Record<string, unknown>): WindowsActiveWindow {
  const bounds = parseBounds(result.bounds);
  const window: WindowsActiveWindow = {};

  if (typeof result.title === "string" && result.title.trim().length > 0) {
    window.title = result.title.trim().slice(0, 500);
  }

  if (typeof result.processName === "string" && result.processName.trim().length > 0) {
    window.processName = result.processName.trim().slice(0, 500);
  }

  if (typeof result.executable === "string" && result.executable.trim().length > 0) {
    window.executable = result.executable.trim().slice(0, 500);
  }

  if (typeof result.processId === "number" && Number.isInteger(result.processId) && result.processId > 0) {
    window.processId = result.processId;
  }

  if (bounds !== undefined) {
    window.bounds = bounds;
  }

  return window;
}

function getPowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot ?? env.windir ?? "C:\\Windows";

  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
