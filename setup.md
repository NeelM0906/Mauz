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

The desktop app launches its local API with an internal random token. If you run the API package directly
for development, set a local token first:

```bash
export MAUZ_LOCAL_API_TOKEN="$(uuidgen)"
pnpm --filter @mauzai/api dev
```

`MAUZ_API_ALLOW_UNAUTHENTICATED=true` is only for isolated local debugging without credentials.

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

Install the packaged macOS app into `/Applications` for normal double-click use:

```bash
pnpm install:mac
```

This stops any running MauzAI processes, rebuilds `/Applications/MauzAI.app`, and replaces `dist/mac/MauzAI.app` with a symlink to the installed app. The next launch uses the new renderer assets even if you previously double-clicked the local packaged app.

Stop the installed app without reinstalling:

```bash
pnpm stop:mac
```

Create the packaged macOS app in `~/Applications/MauzAI.app`:

```bash
pnpm --filter @mauzai/desktop package:mac
```

Create a downloadable DMG in `dist/`:

```bash
pnpm package:dmg:mac
```

Then launch the packaged app:

```bash
pnpm --filter @mauzai/desktop launch:mac
```

If permissions were previously granted to Electron during development, macOS may ask again for the packaged MauzAI app.

Release DMGs built without an Apple Developer ID certificate are ad-hoc signed. They are usable, but macOS Gatekeeper may require users to right-click Open the first time. For fully silent public distribution, sign with a Developer ID Application certificate and notarize the DMG before publishing it.
