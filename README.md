# MauzAI

MauzAI is a macOS-first desktop assistant MVP. It opens a compact AI help popup from a dev hotkey today, captures screenshot context only after the user chooses Ask Mauz, and sends the question through a local Fastify API server to OpenAI.

## Current Milestone

Implemented:

- `apps/desktop`: Electron + React + Vite popup shell.
- `apps/api`: local Fastify API with `GET /healthz` and `POST /api/ask`.
- `packages/shared`: shared TypeScript types, IPC constants, and Zod schemas.
- `CommandOrControl+Shift+M`: opens the Mauz popup near the cursor.
- `Ask Mauz`: hides the popup, captures the current display screenshot, stores context in memory, accepts a question, and renders an OpenAI answer.
- Local API auth: the Electron main process generates a process-lifetime token for `POST /api/ask`.
- `ShakeDetector`: pure TypeScript vertical-shake detector with unit tests.
- Prettier formatting via `pnpm format`.

Not implemented yet:

- Native macOS mouse shake helper.
- Selected text and active-window metadata.
- Realtime voice.
- Screen sharing mode.
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

Run the full local gate:

```bash
pnpm check
```

Format the repo:

```bash
pnpm format
```

Build all packages:

```bash
pnpm build
```

## Controls

- Press `CommandOrControl+Shift+M` to open the Mauz popup near the current cursor position.
- Click `Ask Mauz` to capture screenshot context.
- Press `Esc` or click away to close the popup.

## Environment

Copy `.env.example` to `.env` or provide these variables in the shell before running `pnpm dev`:

```bash
OPENAI_API_KEY=
OPENAI_ASK_MODEL=gpt-5.4-mini
OPENAI_REALTIME_MODEL=gpt-realtime-2
MAUZ_API_PORT=38741
MAUZ_ENABLE_NATIVE_INPUT=false
MAUZ_ENABLE_DEV_HOTKEY=true
```

`OPENAI_API_KEY` is read only by the local API server in the Electron main process. It is never exposed to the renderer.

If screenshot capture fails on macOS, grant Screen Recording permission in System Settings, then restart MauzAI. Ask Mauz still allows text-only questions when screenshot capture is unavailable.

## Privacy Posture

- No screenshot is captured until the user clicks `Ask Mauz`.
- Screenshot context is kept in memory for the current Ask flow.
- Screenshots and selected text are not logged or persisted.
- The local API requires a private `x-mauz-local-token` header generated inside the Electron main process.
- The renderer only receives a small typed API via Electron `contextBridge`; raw `ipcRenderer`, filesystem access, OpenAI credentials, and privileged OS APIs are not exposed.
- Microphone and Realtime features are not implemented in this milestone.

## Local API

The desktop app launches a local Fastify server on `127.0.0.1:${MAUZ_API_PORT}`.

- `GET /healthz` returns `{ "ok": true }`.
- `POST /api/ask` requires `x-mauz-local-token`, validates `AskMauzRequestSchema`, sends text plus optional screenshot image context to the OpenAI Responses API, and returns `AskMauzResponse`.
