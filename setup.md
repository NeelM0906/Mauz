# MauzAI Setup

This guide covers the local macOS preview setup for MauzAI.

## Requirements

- macOS 13 or newer.
- Node.js 22 or newer.
- pnpm 10.27.0 or newer. Run `corepack enable` if pnpm is not available.
- Xcode Command Line Tools for the native mouse-shake helper. Install with `xcode-select --install`.
- An OpenAI API key for Ask, Talk, title generation, and Realtime voice.

## Install

From the repository root:

```bash
pnpm install
```

Build the native macOS input helper if you want mouse-shake activation:

```bash
native/macos/MauzInputAgent/build.sh
```

## OpenAI Login

MauzAI can use OpenAI credentials in two ways:

- Launch environment: start MauzAI with `OPENAI_API_KEY` set in the terminal.
- In-app login: open the Mauz menu or Settings, then use the OpenAI login controls to connect, reconnect, or disconnect. Saved keys are stored through Electron safe storage.

Disconnect makes MauzAI ignore OpenAI credentials, including a launch-time `OPENAI_API_KEY`, until you reconnect. Reconnect re-enables a saved key or the launch key. To replace credentials, paste a new API key in Settings and save.

Optional model settings can be copied from `.env.example` into your shell or local environment:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_ASK_MODEL="gpt-5.4-mini"
export OPENAI_CHAT_TITLE_MODEL="gpt-5.4-nano"
export OPENAI_REALTIME_MODEL="gpt-realtime-2"
```

## macOS Permissions

MauzAI works best with these permissions:

- Accessibility: required for native mouse-shake activation.
- Screen Recording: required when Ask or Talk captures screen context.
- Microphone: required for Talk mode.

Open System Settings, then Privacy & Security, and grant permissions to MauzAI, Electron, or the built local app depending on how you launch it.

## Run Locally

Start the desktop app:

```bash
pnpm dev
```

Useful controls:

- Mouse shake opens the Mauz menu when native input is enabled.
- Command Shift M opens the Mauz menu when the dev hotkey is enabled.
- The Mauz menu includes OpenAI reconnect and disconnect controls.
- Settings lets you save a replacement OpenAI key, clear the saved key, choose models, and tune activation.

## Verify

Run the standard checks:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The full repo check is:

```bash
pnpm check
```

## Package for macOS

Create the packaged macOS app:

```bash
pnpm --filter @mauzai/desktop package:mac
```

Then launch the packaged app:

```bash
pnpm --filter @mauzai/desktop launch:mac
```

If permissions were previously granted to Electron during development, macOS may ask again for the packaged MauzAI app.
