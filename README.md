# MauzAI

MauzAI is a macOS-first desktop assistant MVP. This milestone implements the TypeScript-first shell: pnpm workspace, Electron + React + Vite popup app, a typed preload bridge, development hotkey activation, and a tested mouse shake detector.

## Current milestone

Implemented:

- `apps/desktop`: Electron + React + Vite popup shell.
- `packages/shared`: shared TypeScript types, IPC constants, and Zod schemas.
- `apps/api`: placeholder local API package for later Ask/Talk phases.
- `CommandOrControl+Shift+M`: opens the Mauz popup near the cursor.
- `ShakeDetector`: pure TypeScript vertical-shake detector with unit tests.

Not implemented yet:

- Native macOS input helper.
- Screenshot/selected-text context capture.
- OpenAI Ask/Reatime flows.
- Packaging/signing.

## Development

Install dependencies:

```bash
pnpm install
```

Run the desktop app:

```bash
pnpm dev
```

Run tests:

```bash
pnpm test
```

Run type checks:

```bash
pnpm typecheck
```

## Controls

- Press `CommandOrControl+Shift+M` to open the Mauz popup near the current cursor position.
- Press `Esc` or click away to close the popup.

## Privacy posture

This milestone does not capture screenshots, selected text, microphone input, or OpenAI credentials. The renderer only receives a small typed API via Electron `contextBridge`; raw `ipcRenderer`, filesystem access, and OS APIs are not exposed.

## Environment

Copy `.env.example` to `.env` when later milestones need API settings. The OpenAI variables are present now for future phases only.
