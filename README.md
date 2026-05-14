# MauzAI

MauzAI is a macOS-first point-and-ask desktop assistant MVP. Shake your mouse to summon Mauz, point at anything on screen, and ask for help without leaving your flow.

## Current Milestone

Implemented:

- `apps/desktop`: Electron + React + Vite popup shell.
- `apps/api`: local Fastify API with `GET /healthz`, `POST /api/ask`, and `POST /api/realtime/connect`.
- `packages/shared`: shared TypeScript types, IPC constants, and Zod schemas.
- `CommandOrControl+Shift+M`: opens the Mauz popup near the cursor.
- Native macOS shake helper: optional Swift helper emits global mouse movement samples to the TypeScript `ShakeDetector`.
- `Ask Mauz`: hides the popup, captures a cursor-centered crop plus the current display screenshot, stores context in memory, accepts a question, and renders an OpenAI answer.
- Formatted answers: Ask responses render headings, lists, paragraphs, and code blocks instead of raw text dumps.
- `Prev chats`: opens grouped previous Ask conversations by `MM/DD/YY`. Mauz stores text-only question/answer history and generates a short title with `gpt-5.4-nano`.
- Pointer context engine: Ask payloads now include cursor coordinates, display metadata, active app/window metadata when available, selected text when available, a cursor-area crop, and a full screenshot fallback.
- Shake settings: native shake can be enabled or disabled locally, with relaxed, normal, and strict sensitivity presets.
- `Talk to Mauz`: starts a WebRTC Realtime voice session after the user explicitly chooses Talk.
- `Show Mauz my screen`: starts a Realtime voice session and sends periodic compressed screenshot frames while sharing is visible and not paused.
- Local API auth: the Electron main process generates a process-lifetime token for private local API routes.
- `ShakeDetector`: pure TypeScript vertical-shake detector with unit tests.
- Prettier formatting via `pnpm format`.

Not implemented yet:

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

Build the native macOS input helper:

```bash
native/macos/MauzInputAgent/build.sh
```

## Controls

- Press `CommandOrControl+Shift+M` to open the Mauz popup near the current cursor position.
- On macOS, set `MAUZ_ENABLE_NATIVE_INPUT=true`, build the helper, and rapidly shake the mouse vertically to open Mauz.
- Click `Ask Mauz` to capture pointer context. Mauz captures a crop around the cursor first, then a full screenshot for broader context.
- Click `Prev chats` to browse past text conversations grouped by date.
- Click `Talk to Mauz` to start a natural Realtime voice-agent session with initial pointer/screenshot context. Mauz uses `gpt-realtime-2` with semantic turn detection; mute is only a privacy control.
- Click `Show Mauz my screen` to start voice plus explicit screen sharing. Mauz sends fresh screenshot frames about every two seconds until you pause, stop, or close the panel. Frames update visual context only; Mauz responds to your spoken turns.
- Use the settings button in the Mauz menu to toggle native shake and adjust sensitivity. The dev hotkey fallback remains available unless disabled in local settings.
- Press `Esc` or click away to close the popup.

## Environment

Copy `.env.example` to `.env` or provide these variables in the shell before running `pnpm dev`:

```bash
OPENAI_API_KEY=
OPENAI_ASK_MODEL=gpt-5.4-mini
OPENAI_CHAT_TITLE_MODEL=gpt-5.4-nano
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_REASONING_EFFORT=low
MAUZ_API_PORT=47891
MAUZ_ENABLE_NATIVE_INPUT=false
MAUZ_ENABLE_DEV_HOTKEY=true
```

`OPENAI_API_KEY` is read only by the local API server in the Electron main process. It is never exposed to the renderer.

`MAUZ_ENABLE_NATIVE_INPUT=true` enables the Swift mouse helper on macOS. macOS requires Accessibility permission for global mouse event monitoring. If permission is missing, Mauz shows:

```text
Mauz needs Accessibility permission to detect the mouse shake. Open System Settings -> Privacy & Security -> Accessibility, then enable MauzInputAgent.
```

The helper build script creates `native/macos/MauzInputAgent/MauzInputAgent.app` with bundle identifier `ai.mauz.input-agent`. If macOS does not list it automatically, add that app bundle in Accessibility settings.

If screenshot capture fails on macOS, grant Screen Recording permission in System Settings, then restart MauzAI. Ask Mauz still allows text-only questions when screenshot capture is unavailable.

## Privacy Posture

- No screenshot is captured until the user clicks `Ask Mauz`, `Talk to Mauz`, or `Show Mauz my screen`.
- Mouse shake activation only opens the Mauz menu; it does not capture screenshots.
- Cursor crops and screenshot context are kept in memory for the current flow.
- Cursor crops, screenshots, and selected text are not logged or persisted.
- Previous chats persist only the user's typed question, Mauz's text answer, generated title, and timestamps.
- Selected text capture uses macOS Accessibility APIs when available and does not mutate the clipboard.
- The local API requires a private `x-mauz-local-token` header generated inside the Electron main process.
- The renderer only receives a small typed API via Electron `contextBridge`; raw `ipcRenderer`, filesystem access, OpenAI credentials, and privileged OS APIs are not exposed.
- Microphone access is requested only after the user chooses `Talk to Mauz` or `Show Mauz my screen`.
- Muting the mic disables local audio tracks without closing the Realtime session or muting Mauz's audio output.
- Screen sharing uses explicit periodic screenshot frames, not hidden background capture.

## Local API

The desktop app launches a local Fastify server on `127.0.0.1:${MAUZ_API_PORT}`. The default is `47891`; if that port is already in use, the desktop app tries the next nearby ports before failing startup.

- `GET /healthz` returns `{ "ok": true }`.
- `POST /api/ask` requires `x-mauz-local-token`, validates `AskMauzRequestSchema`, sends text plus optional cursor-crop and screenshot image context to the OpenAI Responses API, and returns `AskMauzResponse`.
- `POST /api/chat/title` requires `x-mauz-local-token`, validates `ChatTitleRequestSchema`, generates a 3-7 word conversation title, and returns `ChatTitleResponse`.
- `POST /api/realtime/connect` requires `x-mauz-local-token`, validates `RealtimeConnectRequestSchema`, sends the renderer-created WebRTC SDP offer to OpenAI Realtime through the server-side unified interface, configures a `gpt-realtime-2` voice-agent session with semantic turn detection, and returns a Realtime SDP answer.

## Realtime Architecture

Mauz uses OpenAI's `/v1/realtime/calls` unified WebRTC interface from the local TypeScript API server. The renderer creates the peer connection and microphone track, but the standard OpenAI API key stays server-side. The session is configured directly as a Realtime voice-agent session because the current MVP needs low-latency speech, pointer context, screen-frame context updates, mute, pause, and stop controls. The Python Agents SDK is deferred until Mauz needs deeper tool orchestration or handoffs that justify a Python runtime in the desktop app.
