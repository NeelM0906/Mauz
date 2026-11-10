// The PowerShell program behind WindowsContextHelper. It reads one JSON request per stdin line and
// writes one JSON response per stdout line.

// Sets UTF-8 before the first read (changing it later drops buffered input), then runs the
// helper script sent as one base64 line on stdin.
export const BOOTSTRAP_SCRIPT = String.raw`
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = $utf8
[Console]::InputEncoding = $utf8
$mauzHelper = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))
Invoke-Expression $mauzHelper
`;

export const HELPER_SCRIPT = String.raw`
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
