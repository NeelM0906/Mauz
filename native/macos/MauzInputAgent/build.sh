#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/MauzInputAgent.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
OUTPUT="$MACOS_DIR/MauzInputAgent"

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR"

cat > "$CONTENTS_DIR/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>MauzInputAgent</string>
  <key>CFBundleIdentifier</key>
  <string>ai.mauz.input-agent</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>MauzInputAgent</string>
  <key>CFBundleDisplayName</key>
  <string>MauzInputAgent</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

xcrun swiftc \
  -O \
  -framework ApplicationServices \
  "$SCRIPT_DIR/main.swift" \
  -o "$OUTPUT"

chmod +x "$OUTPUT"
clear_codesign_metadata() {
  xattr -cr "$APP_DIR" 2>/dev/null || true

  while IFS= read -r -d '' path; do
    xattr -d com.apple.FinderInfo "$path" 2>/dev/null || true
    xattr -d com.apple.ResourceFork "$path" 2>/dev/null || true
    xattr -d 'com.apple.fileprovider.fpfs#P' "$path" 2>/dev/null || true
  done < <(find "$APP_DIR" -print0)
}

clear_codesign_metadata
if ! codesign \
  --force \
  --sign - \
  --requirements '=designated => identifier "ai.mauz.input-agent"' \
  "$APP_DIR" >/dev/null; then
  echo "Warning: could not sign $APP_DIR; the packaged app signs its bundled copy." >&2
fi

echo "Built $APP_DIR"
