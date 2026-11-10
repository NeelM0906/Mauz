# Mauz

Mauz is a desktop assistant that opens at the mouse cursor on macOS and Windows.
It has three features and no others:

- **Ask**: answer a question about the content under the cursor.
- **Send to agent**: give a task to a coding agent (Claude Code, Codex, or Hermes).
- **Dictate**: change speech into text, then send the text to Ask or to an agent.

User setup and environment variables are in `README.md` and `setup.md`.

## Commands

```sh
pnpm dev          # start the Electron app (electron-vite)
pnpm test         # vitest in each package
pnpm typecheck    # tsc --noEmit in each package
pnpm lint         # prettier --check
pnpm check        # lint + env check + secret scan + typecheck + test + build
```

## Layout

pnpm workspace with three packages. All three run in one Electron process at runtime.

| Path                          | Role                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `apps/desktop/src/main`       | Electron main process. `index.ts` builds each service and connects them.     |
| `apps/desktop/src/preload`    | The `window.mauz` bridge. Its shape is `MauzBridge` in `packages/shared`.    |
| `apps/desktop/src/renderer`   | React UI. One panel for each mode. State is in `state/useMauzStore.ts`.      |
| `apps/api/src`                | Answer providers for Ask, and OpenAI transcription for Dictate.              |
| `packages/shared/src`         | Contracts: zod schemas, types, IPC channel names, prompt text builders.      |
| `browser-extension`           | Optional Chrome/Edge extension. It sends page content through a native host. |
| `native/macos/MauzInputAgent` | Swift helper. It prints mouse events as JSON lines on stdout.                |

`apps/desktop/electron.vite.config.ts` aliases `@mauzai/api/server` and `@mauzai/shared`
to their source files. The desktop build bundles both packages from source.

### Main process folders (`apps/desktop/src/main`)

| Folder      | Contents                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------- |
| `input/`    | Activation triggers: mouse shake (`ShakeDetector`), hotkey, macOS helper, cursor polling.     |
| `context/`  | Capture: active window, selected text, screenshot, browser page, Windows helper (PowerShell). |
| `windows/`  | The popover window, its position, the tray, navigation hardening.                             |
| `ipc/`      | `registerIpcHandlers.ts`: one handler for each invoke channel.                                |
| `agent/`    | `TaskAgentLauncher.ts`: find the agent CLI, write the task brief, start the agent.            |
| `settings/` | `SettingsService.ts`: settings file, encrypted API keys.                                      |
| `talk/`     | `TalkTranscriber.ts`: OpenAI first, Windows speech recognition second.                        |
| `server/`   | `launchLocalApi.ts`: starts the loopback HTTP server that Ask uses.                           |

### Answer providers (`apps/api/src/providers`)

`registry.ts` selects one of four `AnswerProvider` implementations: `anthropicProvider`,
`openaiProvider`, `claudeCodeProvider`, `codexProvider`. The two CLI providers use
`cliCommand.ts` (find the binary, clean the environment) and `processRunner.ts` (spawn, collect output).

## Runtime flow

```
shake / hotkey / tray
        |
        v
input/*  -->  index.ts handleActivation  -->  context/ContextCollector (snapshot)
                                         -->  windows/PopoverWindowController (show menu)
        |
renderer (MauzMenu) --window.mauz--> preload --ipcRenderer.invoke--> ipc/registerIpcHandlers
        |
        +-- Ask:           askApiClient --HTTP 127.0.0.1--> apps/api routes/ask --> registry --> provider
        +-- Send to agent: agent/TaskAgentLauncher --> agent desktop app or terminal
        +-- Dictate:       talk/TalkTranscriber --> apps/api transcribeAudio, or Windows helper
```

Answer text streams back through an in-process callback (`ask:delta`), not through HTTP.

## Rules that the code follows

- Each IPC handler calls `assertTrustedSender(event)` first, then parses the payload with a zod schema.
- Platform code is selected with `process.platform`. Windows code is in `context/WindowsContextHelper.ts`.
  macOS code is in JXA strings (`ActiveWindowService.ts`, `SelectedTextService.ts`) and the Swift helper.
- Child processes must not inherit Mauz credentials. Use `buildCliEnvironment` (API) or
  `buildAgentEnvironment` (desktop).
- A new IPC call needs changes in: `MauzBridge` and `IPC_CHANNELS` (shared), the request schema,
  preload, `mauzClient.ts` (wrapper and preview bridge), `HANDLED_IPC_CHANNELS`, and the handler.
- Services accept injected dependencies in an options object. Tests use these to replace
  `spawn`, the file system, and Electron APIs.

## Known drift (audit of 2026-11-10)

- Only Ask uses the loopback HTTP server. All other calls into `apps/api` are direct function imports.
- `.env` is loaded inside `createMauzApiServer`, after `SettingsService` has read the environment.
- CLI discovery and environment cleaning exist in two places with different results:
  `apps/api/src/providers/cliCommand.ts` and `apps/desktop/src/main/agent/TaskAgentLauncher.ts`.
- Names: Ask is also called "lens" and "answer". Dictate is also called "talk" and "pushToTalk".
  `apps/api/src/openai/askMauz.ts` is not specific to OpenAI.
