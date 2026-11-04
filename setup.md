# MauzAI Setup

This guide covers running MauzAI from a clone on macOS and Windows.

## Requirements

- macOS 13 or newer, or Windows 10/11.
- Node.js 22 or newer.
- pnpm 10.27.0 or newer. Run `corepack enable` if pnpm is not available.
- macOS only: Xcode Command Line Tools for the native mouse-shake helper. Install with `xcode-select --install`.
- An AI provider: a signed-in [Claude Code](https://claude.com/claude-code) or [Codex](https://github.com/openai/codex) subscription, or an Anthropic or OpenAI API key. See [AI providers](#ai-providers).

## Install from a clone

### macOS

Clone Mauz, then run the installer from the repository root:

```bash
git clone https://github.com/NeelM0906/Mauz.git
cd Mauz
./install-macos.sh
```

The installer uses the locked pnpm version, builds Mauz, installs it at `~/Applications/MauzAI.app`, and launches it. It does not require an administrator password. Re-run `./install-macos.sh` after pulling updates.

### Windows

Clone Mauz, then double-click `install-windows.cmd`, or run it from a terminal in the repository root:

```powershell
git clone https://github.com/NeelM0906/Mauz.git
cd Mauz
.\install-windows.cmd
```

The installer installs dependencies with the locked pnpm version, builds Mauz, adds a **MauzAI** Start menu shortcut, and launches it. It does not require administrator rights. Add `-StartAtLogin` to also start Mauz when you sign in. Re-run it after pulling updates.

On Windows:

- Shake the mouse or press **Ctrl+Shift+M** to open Mauz. Shake needs no permission.
- Mauz lives in the notification area (system tray): open it, pause mouse shake, or quit from there.
- Mauz reads the active window and selected text through Windows UI Automation. Select text before you shake to use it as context.
- Mauz windows are hidden from screenshots and screen sharing so they never cover what Mauz captures. To show them (for example to demo Mauz in a meeting), set `MAUZ_EXCLUDE_FROM_CAPTURE=false` before launching.
- Microsoft Teams also uses Ctrl+Shift+M (mute). Turn off the shortcut in Settings if you rely on it in Teams.

## AI providers

Mauz answers with the first provider that is ready, unless you pick one under **Settings → AI provider**:

1. An Anthropic API key you added (default model `claude-opus-5-5`).
2. An OpenAI API key you added (default model `gpt-5.4-mini`).
3. Your Claude Code subscription, if the `claude` CLI is installed and signed in (default model `sonnet`).
4. Your Codex (ChatGPT) subscription, if the `codex` CLI is installed and signed in (Codex's default model).

To use a subscription, install the CLI and sign in once in a terminal: run `claude` (then `/login`) for Claude Code, or `codex login` for Codex. Mauz runs these CLIs with tools, hooks, MCP servers, and session history turned off, from an empty working directory, so they only answer the question. Settings shows which providers are ready; use **Check again** after signing in.

Add API keys in Settings (stored encrypted with Electron safe storage: Keychain on macOS, DPAPI on Windows) or through the environment (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Optional overrides:

```bash
MAUZ_AI_PROVIDER=auto            # auto, claude-code, codex, anthropic, or openai
MAUZ_CLAUDE_CODE_MODEL=sonnet    # any model or alias the claude CLI accepts
MAUZ_CODEX_MODEL=                # empty uses Codex's default
ANTHROPIC_ASK_MODEL=claude-opus-5-5
MAUZ_CLAUDE_CODE_PATH=           # only if claude/codex are not on PATH
MAUZ_CODEX_PATH=
```

## Talk (push to talk)

Talk works like [Clicky](https://github.com/farzaa/clicky): hold **Space** (or the **Hold to talk** button), speak, and release. Mauz transcribes the clip, answers with your AI provider using a fresh screenshot around your pointer, and reads the answer aloud with your system voice. Press Space while Mauz is speaking to interrupt it.

Speech-to-text uses OpenAI when you have added an OpenAI API key, otherwise the built-in Windows speech recognizer (offline; install an English speech pack under **Settings → Time & language → Speech** if it is missing). On macOS without an OpenAI key, push to talk is not available yet.

OpenAI's Realtime speech-to-speech voice is still available: choose **Talk uses → OpenAI Realtime voice** in Settings (requires an OpenAI API key).

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
