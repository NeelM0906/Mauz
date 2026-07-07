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

## Hermes Agent Backend

Mauz has two modes, chosen in Settings under **Mode**:

- **Simple** (default): direct OpenAI answering. No gateway needed.
- **Agentic**: routes Ask through the [Hermes](https://github.com/NousResearch/hermes-agent) agent gateway, adding persistent memory, session continuity, and tools (web, browser, code execution, MCP, computer use). When Agentic mode is selected, a Gateway URL field appears (default `http://localhost:8642/v1`); enter a custom OpenAI-compatible URL there to use a different gateway.

To run the Hermes gateway, enable the API server platform in your hermes-agent install and start its gateway:

```bash
export API_SERVER_ENABLED=true    # serves http://127.0.0.1:8642/v1
```

Mauz detects gateway capabilities via `GET {base}/capabilities` and then sends session headers automatically: a per-conversation session id (conversation continuity) and, when a backend API key is configured, a per-install session key for long-term memory scoping. Plain OpenAI-compatible endpoints without a capabilities route keep the exact non-agentic behavior.

Optional environment settings:

```bash
export MAUZ_BACKEND_BASE_URL="http://localhost:8642/v1"  # overrides the default for the selected preset
export MAUZ_BACKEND_API_KEY="..."   # only needed when the gateway has API-key auth; also enables memory scoping
```

### Agent modes

When the connected gateway advertises run support, Ask runs through the gateway's agent-run lifecycle and the popover exposes two modes plus a Stop control:

- **Approve**: each tool action the gateway gates surfaces an approval card in the popover with four choices — Allow once, Allow for session, Always allow, Deny. Closing the popover stops the in-flight run.
- **YOLO**: Mauz auto-approves every gated action (no card). The gateway's own hard floor of never-allowed destructive patterns still applies server-side.

Switch modes from the toggle in the Ask panel (shown only in Agentic mode) or set the default with:

```bash
export MAUZ_AGENT_MODE="approve"   # or "yolo"
```

Note: the gateway may also gate actions through its own `approvals.mode` config; Mauz's Approve/YOLO choice governs how the client responds to the approval requests the gateway raises.

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

## Package for macOS

Install the packaged macOS app into `/Applications` for normal double-click use:

```bash
pnpm install:mac
```

This stops any running MauzAI processes, rebuilds `/Applications/MauzAI.app`, and replaces `dist/mac/MauzAI.app` plus `~/Applications/MauzAI.app` with symlinks to the installed app. The next launch uses the new renderer assets even if you previously double-clicked a local packaged app.

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
