import { spawn } from "node:child_process";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

type ChildProcessLike = {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(): boolean;
  once(event: "exit", listener: (code: number | null) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

export type WindowsContextSpawn = (command: string, args: readonly string[]) => ChildProcessLike;

export type WindowsActiveWindow = {
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
const TRANSCRIBE_TIMEOUT_MS = 30_000;
const MAX_SELECTED_TEXT_CHARS = 8_000;

/**
 * A long-lived PowerShell process that answers context questions about the foreground
 * window: Win32 for the window and owning process, UI Automation for selected text.
 * PowerShell and UIA ship with Windows, so this needs no extra install, and keeping the
 * process alive avoids PowerShell's startup cost on every activation.
 */
export class WindowsContextHelper {
  private readonly spawnHelper: WindowsContextSpawn;
  private child: ChildProcessLike | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(options: { spawn?: WindowsContextSpawn } = {}) {
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
      Buffer.from(HELPER_SCRIPT, "utf16le").toString("base64")
    ]);
    this.child = child;

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

    return isRecord(result) ? parseActiveWindow(result) : {};
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

  private request(
    command: "activeWindow" | "selectedText" | "focusWindow" | "transcribe",
    timeoutMs: number,
    parameters: Record<string, string> = {}
  ): Promise<unknown> {
    this.start();
    const child = this.child;

    if (child?.stdin === null || child === null) {
      return Promise.reject(new Error("Windows context helper is not running."));
    }

    const id = this.nextRequestId++;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // A UIA call into a hung app can block the helper; restart it so later requests work.
        this.restart();
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
    }

    this.failPending(new Error("Windows context helper exited."));
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

function parseActiveWindow(result: Record<string, unknown>): WindowsActiveWindow {
  const bounds = isRecord(result.bounds) ? result.bounds : undefined;
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

  if (
    bounds !== undefined &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every((value) => typeof value === "number")
  ) {
    window.bounds = {
      x: bounds.x as number,
      y: bounds.y as number,
      width: Math.max(0, bounds.width as number),
      height: Math.max(0, bounds.height as number)
    };
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

const HELPER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MauzWin32 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
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

function Get-MauzActiveWindow {
  $handle = [MauzWin32]::GetForegroundWindow()
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
      'focusWindow' { $response.result = [MauzWin32]::Focus([IntPtr][long]$request.handle) }
      'transcribe' { $response.result = Invoke-MauzTranscription $request.path }
      default { $response.error = 'unknown command' }
    }
  } catch {
    $response.error = if ($request.command -eq 'transcribe') { "$($_.Exception.Message)" } else { 'context lookup failed' }
  }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 4))
  [Console]::Out.Flush()
}
`;
