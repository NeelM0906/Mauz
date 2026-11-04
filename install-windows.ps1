# Builds MauzAI from this clone and adds a Start menu shortcut. No administrator rights needed.
# Run from the repository root:  powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
param(
  # Also start MauzAI when you sign in to Windows.
  [switch]$StartAtLogin,
  # Build and create shortcuts without launching.
  [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

function Fail([string]$message) {
  Write-Host $message -ForegroundColor Red
  exit 1
}

if ($env:OS -ne 'Windows_NT') {
  Fail 'install-windows.ps1 only runs on Windows. On macOS, use ./install-macos.sh.'
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
  Fail 'Node.js 22 or newer is required. Install it from https://nodejs.org, then rerun this script.'
}

$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 22) {
  Fail "Node.js 22 or newer is required (found $nodeMajor). Update Node.js, then rerun this script."
}

if ($null -eq (Get-Command corepack -ErrorAction SilentlyContinue)) {
  Fail 'Corepack is required. Install a Node.js distribution that includes Corepack, then rerun this script.'
}

# Some tools (for example Electron-based terminals) export this, which makes Electron run as plain Node.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

Write-Host 'Installing dependencies...'
& corepack pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { Fail 'pnpm install failed.' }

$electronPackage = Join-Path $repoRoot 'apps\desktop\node_modules\electron'
$electronExe = Join-Path $electronPackage 'dist\electron.exe'
if (-not (Test-Path $electronExe)) {
  Write-Host 'Downloading the Electron runtime...'
  & node (Join-Path $electronPackage 'install.js')
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $electronExe)) { Fail 'Electron runtime download failed.' }
}

Write-Host 'Building MauzAI...'
& corepack pnpm --filter '@mauzai/desktop' build
if ($LASTEXITCODE -ne 0) { Fail 'MauzAI build failed.' }

$appDirectory = Join-Path $repoRoot 'apps\desktop'
$iconPath = Join-Path $appDirectory 'build\mauzai.ico'
$shell = New-Object -ComObject WScript.Shell

function New-MauzShortcut([string]$path) {
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $electronExe
  $shortcut.Arguments = "`"$appDirectory`""
  $shortcut.WorkingDirectory = $appDirectory
  $shortcut.IconLocation = $iconPath
  $shortcut.Description = 'MauzAI desktop assistant'
  $shortcut.Save()
}

$startMenuShortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'MauzAI.lnk'
New-MauzShortcut $startMenuShortcut
Write-Host "Added Start menu shortcut: $startMenuShortcut"

$startupShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'MauzAI.lnk'
if ($StartAtLogin) {
  New-MauzShortcut $startupShortcut
  Write-Host 'MauzAI will start when you sign in.'
} elseif (Test-Path $startupShortcut) {
  Remove-Item $startupShortcut
}

if (-not $NoLaunch) {
  # Restart any running copy so the new build is used.
  Get-Process electron -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -like "$repoRoot\*" } |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $startMenuShortcut
  Write-Host 'MauzAI is running. Shake your mouse or press Ctrl+Shift+M to open it.'
}
