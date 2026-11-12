# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mauz

Mauz is a desktop assistant that opens at the mouse cursor on macOS and Windows.
It has three features and no others:

- **Ask**: answer a question about the content under the cursor.
- **Send to agent**: give a task to a coding agent (Claude Code, Codex, or Hermes).
- **Dictate**: change speech into text, then send the text to Ask or to an agent.

User setup and environment variables are in `README.md` and `setup.md`.

## Commands

```sh
pnpm dev          # start the Electron app (electron-vite)
pnpm test         # vitest in apps/api and apps/desktop (packages/shared has no tests)
pnpm typecheck    # tsc --noEmit in each package
pnpm lint         # prettier --check
pnpm check        # lint + env check + secret scan + typecheck + test + build

# one test file, or one test by name (tests live in apps/<pkg>/tests)
pnpm --filter @mauzai/api exec vitest run tests/providers.test.ts
pnpm --filter @mauzai/desktop exec vitest run -t "<test name>"
```

- If `pnpm` is not on PATH, use `corepack pnpm`.
- If the shell sets `ELECTRON_RUN_AS_NODE=1` (true inside some Electron-hosted agent tools), Electron
  starts as plain Node and `pnpm dev` fails on `BrowserWindow`. Unset it first.
- On a Windows checkout with `core.autocrlf=true`, repo-wide `pnpm lint` flags every file. Run
  prettier on the changed files only.

## Layout

pnpm workspace with three packages. All three run in one Electron process at runtime.

| Path                          | Role                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `apps/desktop/src/main`       | Electron main process. `index.ts` builds each service and connects them.     |
| `apps/desktop/src/preload`    | The `window.mauz` bridge. Its shape is `MauzBridge` in `packages/shared`.    |
| `apps/desktop/src/renderer`   | React UI. One panel for each mode. State is in `state/useMauzStore.ts`.      |
| `apps/api/src`                | Ask providers, and OpenAI transcription for Dictate.                         |
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
| `agent/`    | `TaskAgentLauncher.ts`: find the agent CLI, write the brief; `agentProcess.ts`: start it.     |
| `settings/` | `SettingsService.ts`: settings file, encrypted API keys.                                      |
| `dictate/`  | `DictateTranscriber.ts`: OpenAI first, Windows speech recognition second.                     |

### Ask providers (`apps/api/src/providers`)

`registry.ts` selects one of four `AskProvider` implementations: `anthropicProvider`,
`openaiProvider`, `claudeCodeProvider`, `codexProvider`. The two CLI providers use
`cliCommand.ts` (find the binary, clean the environment) and `processRunner.ts` (spawn, collect output,
and turn a CLI failure into a user message with `describeCliFailure` and `toCliError`).

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
        +-- Ask:           registerIpcHandlers --> answerAsk --> askMauz --> registry --> provider
        +-- Send to agent: agent/TaskAgentLauncher --> agent desktop app or terminal
        +-- Dictate:       dictate/DictateTranscriber --> apps/api transcribeAudio, or Windows helper
```

Every call into `apps/api` is a direct function import from `@mauzai/api/server`. Answer text streams
as `ask:delta` events keyed by `requestId`. `bootstrap()` loads `.env` first, before any service reads
the environment.

## Rules that the code follows

- Each IPC handler is registered with `handle()` in `registerIpcHandlers.ts`, which calls
  `assertTrustedSender(event)` first. The handler then parses the payload with a zod schema.
- Platform code is selected with `process.platform`. Windows code is in `context/WindowsContextHelper.ts`
  (its PowerShell program is in `windowsHelperScript.ts`).
  macOS code is in JXA strings (`ActiveWindowService.ts`, `SelectedTextService.ts`) and the Swift helper.
- A contract type is defined once, as a zod schema in `schemas.ts`; `types.ts` infers it with `z.infer`.
  Only `MauzBridge` and `BrowserExtensionStatus` are written by hand.
- Child processes must not inherit Mauz credentials. Use `buildCliEnvironment` (API) or
  `buildAgentEnvironment` (desktop, which calls `buildCliEnvironment`).
- CLI search folders and the `MAUZ_*_PATH` overrides are in `cliCommand.ts` only. `TaskAgentLauncher`
  uses them through `@mauzai/api/server`, but keeps Windows `.cmd` shims as they are (it starts the
  agent through a terminal or `cmd.exe`); Ask resolves them to `node <script>`.
- A new IPC call needs changes in: `MauzBridge` and `IPC_CHANNELS` (shared), the request schema,
  preload, and the handler. The renderer calls the bridge through `mauz()`
  (`lib/mauzClient.ts`); it runs only in Electron.
- Services accept injected dependencies in an options object. Tests use these to replace
  `spawn`, the file system, and Electron APIs.
- In code the features are named `ask`, `task` (Send to agent) and `dictate`. Do not add other
  names for them, such as "lens" or "talk". "answer" means only the text that Ask returns.

## Known drift (audit of 2026-11-10)

- `apps/api/src/openai/askMauz.ts` is not specific to OpenAI.
