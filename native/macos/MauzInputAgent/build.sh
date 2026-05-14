#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT="$SCRIPT_DIR/MauzInputAgent"

xcrun swiftc \
  -O \
  -framework ApplicationServices \
  "$SCRIPT_DIR/main.swift" \
  -o "$OUTPUT"

chmod +x "$OUTPUT"
echo "Built $OUTPUT"
