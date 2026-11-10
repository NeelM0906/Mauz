import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";
import type { Bounds, PointerTarget, PointerTargetElement, ScreenshotPayload } from "@mauzai/shared";

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

// Sets UTF-8 before the first read (changing it later drops buffered input), then runs the
// helper script sent as one base64 line on stdin.
const BOOTSTRAP_SCRIPT = String.raw`
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
$mauzHelper = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
Invoke-Expression $mauzHelper
`;

const HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MauzWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hWnd, uint cmd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hWnd, int index);
  [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetCloaked(IntPtr hWnd, int attribute, out int value, int size);

  // The topmost visible window at a point, skipping one process's windows (Mauz's own) and
  // click-through overlays, which WindowFromPoint would also skip.
  public static IntPtr WindowAtPointExcluding(int x, int y, uint excludedProcessId) {
    for (IntPtr h = GetTopWindow(IntPtr.Zero); h != IntPtr.Zero; h = GetWindow(h, 2)) {
      if (!IsWindowVisible(h) || IsIconic(h)) { continue; }
      uint owner;
      GetWindowThreadProcessId(h, out owner);
      if (owner == excludedProcessId) { continue; }
      int exStyle = GetWindowLong(h, -20);
      if ((exStyle & 0x20) != 0 && (exStyle & 0x80000) != 0) { continue; }
      int cloaked;
      if (DwmGetCloaked(h, 14, out cloaked, 4) == 0 && cloaked != 0) { continue; }
      RECT rect;
      if (GetWindowRect(h, out rect) && x >= rect.Left && x < rect.Right && y >= rect.Top && y < rect.Bottom) { return h; }
    }
    return IntPtr.Zero;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attribute, out RECT rect, int size);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint attach, uint attachTo, bool shouldAttach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extraInfo);

  public static bool Focus(IntPtr target) {
    IntPtr foreground = GetForegroundWindow();
    if (foreground == target) { return true; }
    uint foregroundThread = GetWindowThreadProcessId(foreground, IntPtr.Zero);
    uint currentThread = GetCurrentThreadId();
    bool attached = foregroundThread != 0 && foregroundThread != currentThread && AttachThreadInput(currentThread, foregroundThread, true);
    try {
      BringWindowToTop(target);
      SetForegroundWindow(target);
    } finally {
      if (attached) { AttachThreadInput(currentThread, foregroundThread, false); }
    }
    if (GetForegroundWindow() == target) { return true; }
    // Fallback: a synthetic Alt tap counts as input to this process, which grants foreground rights.
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    SetForegroundWindow(target);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    return GetForegroundWindow() == target;
  }
}
"@

# Physical pixels on every monitor; Mauz converts to and from Electron DIPs.
try { [void][MauzWin32]::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { }

function Get-MauzActiveWindow {
  return Get-MauzWindowInfo ([MauzWin32]::GetForegroundWindow())
}

function Get-MauzWindowInfo([IntPtr]$handle) {
  if ($handle -eq [IntPtr]::Zero) { return @{} }
  $length = [MauzWin32]::GetWindowTextLength($handle)
  $builder = New-Object System.Text.StringBuilder ($length + 1)
  [void][MauzWin32]::GetWindowText($handle, $builder, $builder.Capacity)
  $ownerId = [uint32]0
  [void][MauzWin32]::GetWindowThreadProcessId($handle, [ref]$ownerId)
  $result = @{ title = $builder.ToString(); processId = [int]$ownerId }
  try {
    $process = Get-Process -Id $ownerId
    $result.processName = $process.ProcessName
    try {
      $result.executable = [System.IO.Path]::GetFileName($process.MainModule.FileName)
      $description = $process.MainModule.FileVersionInfo.FileDescription
      if ($description) { $result.processName = $description }
    } catch { }
  } catch { }
  $rect = New-Object MauzWin32+RECT
  $hasBounds = [MauzWin32]::DwmGetWindowAttribute($handle, 9, [ref]$rect, [System.Runtime.InteropServices.Marshal]::SizeOf($rect)) -eq 0
  if (-not $hasBounds) { $hasBounds = [MauzWin32]::GetWindowRect($handle, [ref]$rect) }
  if ($hasBounds) {
    $result.bounds = @{ x = $rect.Left; y = $rect.Top; width = $rect.Right - $rect.Left; height = $rect.Bottom - $rect.Top }
  }
  return $result
}

function Get-MauzSelectedText {
  $element = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -eq $element) { return '' }
  $pattern = $null
  if (-not $element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) { return '' }
  $parts = @()
  foreach ($range in $pattern.GetSelection()) { $parts += $range.GetText(8000) }
  return ($parts -join [Environment]::NewLine)
}

$script:mauzWalker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Limit-MauzText([string]$text, [int]$max) {
  if ([string]::IsNullOrWhiteSpace($text)) { return $null }
  $trimmed = $text.Trim()
  if ($trimmed.Length -gt $max) { return $trimmed.Substring(0, $max) }
  return $trimmed
}

function Get-MauzRole($element) {
  return ($element.Current.ControlType.ProgrammaticName -replace '^ControlType\.', '')
}

function Get-MauzBounds($element) {
  $rect = $element.Current.BoundingRectangle
  if ($rect.IsEmpty -or [double]::IsInfinity($rect.X) -or [double]::IsInfinity($rect.Width)) { return $null }
  if ($rect.Width -le 0 -or $rect.Height -le 0) { return $null }
  return @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height }
}

# The paragraph under the point, from the nearest element (or ancestor) that exposes text.
function Get-MauzTextAtPoint($element, $point) {
  $candidate = $element
  for ($depth = 0; $depth -lt 4 -and $null -ne $candidate; $depth++) {
    $pattern = $null
    if ($candidate.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
      if ($candidate.Current.IsPassword) { return $null }
      $range = $pattern.RangeFromPoint($point)
      $range.ExpandToEnclosingUnit([System.Windows.Automation.Text.TextUnit]::Paragraph)
      return $range.GetText(4000)
    }
    $candidate = $script:mauzWalker.GetParent($candidate)
  }
  return $null
}

# Visible text inside a group (a card, a dialog), depth first, bounded in nodes, size, and time.
function Get-MauzSubtreeText($root) {
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $text = New-Object System.Text.StringBuilder
  $stack = New-Object System.Collections.Stack
  $stack.Push($root)
  $visited = 0
  while ($stack.Count -gt 0 -and $visited -lt 120 -and $text.Length -lt 4000 -and $watch.ElapsedMilliseconds -lt 250) {
    $node = $stack.Pop()
    $visited++
    $current = $node.Current
    if (-not $current.IsPassword -and -not [string]::IsNullOrWhiteSpace($current.Name)) {
      $name = ($current.Name -replace '\s+', ' ').Trim()
      # Groups often repeat their children's text in their own name.
      if (-not $text.ToString().Contains($name)) { [void]$text.AppendLine($name) }
    }
    $children = New-Object System.Collections.ArrayList
    $child = $script:mauzWalker.GetFirstChild($node)
    while ($null -ne $child -and $children.Count -lt 40) {
      [void]$children.Add($child)
      $child = $script:mauzWalker.GetNextSibling($child)
    }
    for ($index = $children.Count - 1; $index -ge 0; $index--) { $stack.Push($children[$index]) }
  }
  return $text.ToString()
}

function Get-MauzElementAtPoint([double]$x, [double]$y, [int]$excludedProcessId) {
  $point = New-Object System.Windows.Point($x, $y)
  $element = [System.Windows.Automation.AutomationElement]::FromPoint($point)

  $win32Point = New-Object MauzWin32+POINT
  $win32Point.X = [int]$x
  $win32Point.Y = [int]$y
  $rootHandle = [MauzWin32]::GetAncestor([MauzWin32]::WindowFromPoint($win32Point), 2)
  $window = Get-MauzWindowInfo $rootHandle

  # Over an excluded (Mauz) window: report the app window behind it, without reading its contents.
  $excluded = $excludedProcessId -gt 0 -and ($window.processId -eq $excludedProcessId -or ($null -ne $element -and $element.Current.ProcessId -eq $excludedProcessId))
  if ($excluded) {
    $behind = [MauzWin32]::WindowAtPointExcluding([int]$x, [int]$y, [uint32]$excludedProcessId)
    if ($behind -eq [IntPtr]::Zero) { return @{} }
    $behindWindow = Get-MauzWindowInfo $behind
    return @{ element = @{ role = 'Window'; name = Limit-MauzText $behindWindow.title 500; bounds = $behindWindow.bounds }; window = $behindWindow }
  }
  if ($null -eq $element) { return @{ window = $window } }

  $current = $element.Current
  $target = @{ role = Get-MauzRole $element; name = Limit-MauzText $current.Name 500; bounds = Get-MauzBounds $element }
  if (-not $current.IsPassword) {
    $valuePattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$valuePattern)) {
      $target.value = Limit-MauzText $valuePattern.Current.Value 2000
    }
    try { $target.text = Limit-MauzText (Get-MauzTextAtPoint $element $point) 4000 } catch { }
  }
  $result = @{ element = $target; window = $window }

  # The group around the element: the highest ancestor that is still a small part of the window.
  if ($null -ne $window.bounds) {
    $maxArea = 0.4 * [double]$window.bounds.width * [double]$window.bounds.height
    $container = $null
    $ancestor = $script:mauzWalker.GetParent($element)
    for ($depth = 0; $depth -lt 12 -and $null -ne $ancestor; $depth++) {
      if ([long]$ancestor.Current.NativeWindowHandle -eq $rootHandle.ToInt64()) { break }
      $bounds = Get-MauzBounds $ancestor
      if ($null -ne $bounds) {
        if ([double]$bounds.width * [double]$bounds.height -gt $maxArea) { break }
        $container = $ancestor
      }
      $ancestor = $script:mauzWalker.GetParent($ancestor)
    }
    if ($null -ne $container) {
      $result.container = @{
        role = Get-MauzRole $container
        name = Limit-MauzText $container.Current.Name 500
        bounds = Get-MauzBounds $container
        text = Limit-MauzText (Get-MauzSubtreeText $container) 4000
      }
    }
  }
  return $result
}

$script:mauzOcr = $null

# Windows.Media.Ocr through WinRT interop: offline, and installed with the Windows language packs.
function Get-MauzOcr {
  if ($null -ne $script:mauzOcr) { return $script:mauzOcr }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'
  } | Select-Object -First 1
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'No Windows OCR language is installed.' }
  $script:mauzOcr = @{ engine = $engine; asTask = $asTask }
  return $script:mauzOcr
}

function Wait-MauzOperation($ocr, $operation, [Type]$resultType) {
  $task = $ocr.asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(2500)) { throw 'OCR timed out' }
  return $task.Result
}

function Invoke-MauzOcr([string]$base64) {
  $ocr = Get-MauzOcr
  $bytes = [Convert]::FromBase64String($base64)
  $stream = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream((New-Object System.IO.MemoryStream (, $bytes)))
  $decoder = Wait-MauzOperation $ocr ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Wait-MauzOperation $ocr ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Wait-MauzOperation $ocr ($ocr.engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $lines = @()
  foreach ($line in $result.Lines) { $lines += $line.Text }
  return ($lines -join [Environment]::NewLine)
}

$script:mauzRecognizer = $null

function Get-MauzRecognizer {
  if ($null -ne $script:mauzRecognizer) { return $script:mauzRecognizer }
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  if ($installed.Count -eq 0) { throw 'Windows speech recognition is not installed. Add an English speech pack in Settings > Time & language > Speech.' }
  $uiCulture = [System.Globalization.CultureInfo]::CurrentUICulture.Name
  $info = $installed | Where-Object { $_.Culture.Name -eq $uiCulture } | Select-Object -First 1
  if ($null -eq $info) { $info = $installed | Where-Object { $_.Culture.Name -eq 'en-US' } | Select-Object -First 1 }
  if ($null -eq $info) { $info = $installed[0] }
  $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $info
  $engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
  $script:mauzRecognizer = $engine
  return $engine
}

function Invoke-MauzRecognition([string]$path) {
  $engine = Get-MauzRecognizer
  $engine.SetInputToWaveFile($path)
  try {
    $parts = @()
    while ($true) {
      $result = $engine.Recognize()
      if ($null -eq $result) { break }
      $parts += $result.Text
    }
    return ($parts -join ' ')
  } finally {
    $engine.SetInputToNull()
  }
}

function Invoke-MauzTranscription([string]$path) {
  try {
    return Invoke-MauzRecognition $path
  } catch [System.InvalidOperationException] {
    # A recognizer left in a bad state by an earlier request is rebuilt once.
    if ($null -ne $script:mauzRecognizer) { $script:mauzRecognizer.Dispose() }
    $script:mauzRecognizer = $null
    return Invoke-MauzRecognition $path
  }
}

try { [void][System.Windows.Automation.AutomationElement]::FocusedElement } catch { }
# Load the OCR engine now so the first OCR request does not pay for it.
try { [void](Get-MauzOcr) } catch { }
[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $response = @{ id = 0 }
  try {
    $request = $line | ConvertFrom-Json
    $response.id = [int]$request.id
    switch ($request.command) {
      'activeWindow' { $response.result = Get-MauzActiveWindow }
      'selectedText' { $response.result = Get-MauzSelectedText }
      'elementAtPoint' { $response.result = Get-MauzElementAtPoint ([double]$request.x) ([double]$request.y) ([int]$request.exclude) }
      'ocr' { $response.result = Invoke-MauzOcr $request.image }
      'focusWindow' { $response.result = [MauzWin32]::Focus([IntPtr][long]$request.handle) }
      'transcribe' { $response.result = Invoke-MauzTranscription $request.path }
      default { $response.error = 'unknown command' }
    }
  } catch {
    $response.error = if ($request.command -eq 'transcribe') { "$($_.Exception.Message)" } else { 'context lookup failed' }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}
`;
