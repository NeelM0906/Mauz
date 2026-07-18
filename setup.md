# MauzAI Setup

This guide covers the local macOS preview setup for MauzAI.

## Requirements

- macOS 13 or newer.
- Node.js 22 or newer.
- pnpm 10.27.0 or newer. Run `corepack enable` if pnpm is not available.
- Xcode Command Line Tools for the native mouse-shake helper. Install with `xcode-select --install`.
- An OpenAI API key for Ask, Talk, title generation, and Realtime voice.

## Install from a clone

Clone Mauz, then run the installer from the repository root:

```bash
git clone https://github.com/NeelM0906/Mauz.git
cd Mauz
./install-macos.sh
```

The installer uses the locked pnpm version, builds Mauz, installs it at `~/Applications/MauzAI.app`, and launches it. It does not require an administrator password. Re-run `./install-macos.sh` after pulling updates.

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

## Agent gateway and Work on this

Mauz uses **Simple** mode by default for quick contextual answers. To use tools for a longer task, choose **Agentic** under **Settings → Mode**, configure the Gateway URL, save, and check the gateway readiness message shown there.

Gateway readiness can report:

- **Ready**: **Work on this** can start a supervised, tool-enabled task.
- **Unavailable**: Mauz cannot reach or recognize the configured gateway. Check that the gateway is running and that its URL is correct.
- **Unsupported**: the gateway is reachable but does not support supervised runs. Use a gateway with run support.

The default Gateway URL is `http://localhost:8642/v1`. To run the supported [Hermes](https://github.com/NousResearch/hermes-agent) gateway locally, enable its API server platform and start the gateway:

```bash
export API_SERVER_ENABLED=true    # serves http://127.0.0.1:8642/v1
```

Optional environment settings:

```bash
export MAUZ_BACKEND_BASE_URL="http://localhost:8642/v1"
export MAUZ_BACKEND_API_KEY="..."   # only needed when the gateway requires API-key authentication
```

### Supervised tool use

Choose **Work on this** when you want Mauz to investigate an outcome and use gateway tools. Work starts only when gateway readiness is **Ready**, shows activity while it runs, asks for approval before gated actions, and provides a Stop control.

The advanced **Agent mode** setting remains available in Settings:

- **Approve**: gated actions show a card with Allow once, Allow for session, Always allow, and Deny choices.
- **YOLO**: automatically approves gated actions. Use it only when you trust the task and gateway.

You can set the default advanced mode with:

```bash
export MAUZ_AGENT_MODE="approve"   # or "yolo"
```

## macOS Permissions

MauzAI works best with these permissions:

- Accessibility: required for native mouse-shake activation.
- Screen Recording: required when Ask or Talk captures screen context.
- Microphone: required for Talk mode.

Open System Settings, then Privacy & Security, and grant permissions to MauzAI, Electron, or the built local app depending on how you launch it.

### After updating or reinstalling

MauzAI is ad-hoc signed, so every rebuild changes the code hash and macOS silently drops previously granted permissions. After updating or reinstalling the app, re-grant the following in **System Settings → Privacy & Security**:

- **Accessibility** — enable MauzInputAgent (required for mouse-shake).
- **Screen Recording** — enable MauzAI (required for screen context).

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

## Update or stop the macOS app

After pulling updates, rerun the installer:

```bash
./install-macos.sh
```

Stop MauzAI without reinstalling:

```bash
pnpm stop:mac
```

If permissions were previously granted to Electron during development, macOS may ask again for the packaged MauzAI app.
