#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "MauzAI can only be installed on macOS." >&2
  exit 1
fi

if ! command -v node >/dev/null || (( $(node -p 'process.versions.node.split(".")[0]') < 22 )); then
  echo "Node.js 22 or newer is required. Install it, then rerun this script." >&2
  exit 1
fi

if ! command -v xcrun >/dev/null || ! xcrun --find swift >/dev/null 2>&1; then
  echo "Xcode Command Line Tools are required. Run 'xcode-select --install', then rerun this script." >&2
  exit 1
fi

if ! command -v corepack >/dev/null; then
  echo "Corepack is required. Install a Node.js distribution that includes Corepack, then rerun this script." >&2
  exit 1
fi

corepack pnpm install --frozen-lockfile
corepack pnpm install:mac
