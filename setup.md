# MauzAI Setup

How to install, configure, and develop MauzAI from a clone. For what Mauz does, see the [README](README.md).

## Requirements

- macOS 13 or newer, or Windows 10/11.
- Node.js 22 or newer.
- pnpm 10.27.0 or newer. Run `corepack enable` if pnpm is not available.
- macOS only: Xcode Command Line Tools for the native mouse-shake helper (`xcode-select --install`).
- An AI provider. See [AI providers](#ai-providers).

## Install

Run the installer from the repository root. It installs dependencies with the locked pnpm version, builds Mauz, installs it, and launches it. It needs no administrator rights. Re-run it after pulling updates.

**macOS** installs `~/Applications/MauzAI.app`:

```bash
./install-macos.sh
```

Then grant the [macOS permissions](#macos-permissions).

**Windows** adds a **MauzAI** Start menu shortcut. Double-click `install-windows.cmd`, or run:

```powershell
.\install-windows.cmd
```

Add `-StartAtLogin` to also start Mauz when you sign in, or `-NoLaunch` to build without launching.

On Windows, Mauz lives in the notification area (system tray): open it, pause mouse shake, or quit from there. Shake needs no permission, and selected text is read through UI Automation, so select text before you shake to use it as context. Microsoft Teams also uses **Ctrl+Shift+M** (mute); turn off Mauz's shortcut in Settings if you rely on it there.

Mauz's windows are hidden from screenshots and screen sharing so they never cover what Mauz captures. To show them (for example in a demo), set `MAUZ_EXCLUDE_FROM_CAPTURE=false` before launching.

## AI providers

Mauz answers with the provider you have set up:

- An Anthropic API key (default model `claude-opus-5-5`).
- An OpenAI API key (default model `gpt-5.4-mini`).
- Your Claude subscription through Claude Code (default model `sonnet`).
- Your ChatGPT subscription through Codex (Codex's default model).

If only one is set up, Mauz uses it. If several are, **Settings → General AI → Default provider** picks one. Left on **Automatic**, Mauz prefers an API key, then Claude Code, then Codex.

**API keys:** paste them in Settings (stored with Electron safe storage: Keychain on macOS, DPAPI on Windows), or start Mauz with `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set. Disconnecting a provider in Settings makes Mauz ignore its key, including one from the environment, until you reconnect.

**Subscriptions:** click **Connect** next to Claude Code or Codex in **Settings → General AI**.

- If the CLI is missing, Mauz installs it with npm (the button says **Install & connect**).
- Mauz runs the CLI's own sign-in and opens the sign-in page in your browser. Codex shows a one-time code in Mauz to enter on the page. Claude Code usually finishes on its own; if the page shows a code instead, paste it into Mauz.
- The CLI stores the sign-in, exactly as if you had signed in from a terminal. If it is already signed in, Mauz picks it up and there is nothing to connect. **Sign out** signs the CLI out, and **Check again** re-reads its state.

Mauz runs these CLIs with tools, hooks, MCP servers, and session history turned off, from an empty working directory, so they only answer the question.

Optional overrides (see `.env.example` for every variable):

```bash
MAUZ_AI_PROVIDER=auto            # auto, claude-code, codex, anthropic, or openai
MAUZ_CLAUDE_CODE_MODEL=sonnet    # any model or alias the claude CLI accepts
MAUZ_CODEX_MODEL=                # empty uses Codex's default
ANTHROPIC_ASK_MODEL=claude-opus-5-5
OPENAI_ASK_MODEL=gpt-5.4-mini
MAUZ_CLAUDE_CODE_PATH=           # only if claude/codex are not on PATH
MAUZ_CODEX_PATH=
```

## Send to agent

Send to agent hands a task to a coding agent installed on your computer. Mauz writes the brief (your task plus the selected text, pointed element, page, and window it captured) and the screenshot to a temporary folder (`%TEMP%\mauz-handoff` on Windows), then starts the agent in the folder you pick. Mauz deletes the folder after a day.

Choose the agent in **Settings → Task agent**. **Automatic** uses the first one installed, in the order Hermes, Claude Code, Codex. Set the default from the environment with `MAUZ_TASK_AGENT` (`auto`, `hermes`, `claude-code`, or `codex`).

**Windows, agent's desktop app installed:** the task starts as a new thread in that app, in the background. No terminal opens, no window appears, and focus stays where it was. Open the app to follow the thread. If the app is closed, it starts hidden in the tray.

**Otherwise, and on macOS:** the agent opens in a new terminal window (Windows Terminal or PowerShell on Windows, Terminal on macOS):

| Agent       | Terminal command                                                      |
| ----------- | --------------------------------------------------------------------- |
| Hermes      | `hermes chat --query-file <brief> --image <screenshot> --in <folder>` |
| Claude Code | `claude --add-dir <brief folder> "Read the task brief in …"`          |
| Codex       | `codex -C <folder> "Read the task brief in …" -i <screenshot>`        |

Mauz does not monitor the agent, approve its actions, or show its results. Each agent applies its own permissions:

- **Claude:** a background run can't stop to ask you, so it may edit files in the chosen folder. Anything else that needs approval, such as shell commands not already allowed, is refused.
- **Codex:** the thread uses the Codex app's own defaults (for example "ask before acting" with a read-only sandbox). Approval prompts wait in that thread.
- **Hermes:** dangerous commands are refused in one-off runs. Mauz does not pass Hermes' auto-approve flag.

The folder picker lists the folder you last used with that agent, then the folders the agent has worked in, then the **Default work folder** from Settings (your home folder if empty). **Browse** picks any other folder. When you point at VS Code, Cursor, or Windsurf, Mauz preselects the folder whose name appears in the window title.

If an agent doesn't start, its output is in `agent.log` next to the brief. The Codex wake link and Claude's hidden-startup flag are undocumented parts of those apps, so an app update could break them.

## Dictate

Choose **Dictate** on the dial and speak. Press **Stop** (or Space) when you are done; the text appears in an editable box. Send it to **Ask** or **Send to agent**. Mauz uses what was under your pointer when the dial opened.

Speech-to-text uses OpenAI when you have an OpenAI API key, otherwise the built-in Windows speech recognizer (offline; install an English speech pack under **Settings → Time & language → Speech** if it is missing). On macOS without an OpenAI key, Dictate is not available yet.

## Browser extension (optional)

The Mauz extension for Chrome and Edge lets Mauz read the page under the pointer: its address, text, the element you point at, and product details shops publish (price, brand, sizes, stock). Without it, Mauz still reads pages through the screen and UI Automation.

1. Open `chrome://extensions` or `edge://extensions` and turn on Developer mode.
2. Choose **Load unpacked** and pick `browser-extension/extension` in your clone. **Settings → Browser extension** has a button that opens this folder.
3. Keep Mauz running. It registers its browser helper each time it starts, and Settings shows the browser as connected within a minute.

The extension reads nothing until you summon Mauz over that browser, and only from the active tab. Sites on **Settings → Never capture** (banking and payments by default) are not read or screenshotted.

## macOS permissions

Open System Settings → Privacy & Security and grant:

- **Accessibility:** enable MauzInputAgent (mouse shake and selected text).
- **Screen Recording:** enable MauzAI (screenshots).
- **Microphone:** enable MauzAI (Dictate).

MauzAI is ad-hoc signed, so every rebuild changes its code hash and macOS silently drops the permissions. Re-grant them after each update or reinstall. If you granted them to Electron during development, macOS asks again for the packaged app.

## Development

```bash
pnpm dev          # run the desktop app
pnpm check        # format, env, secrets, typecheck, test, build
```

The desktop app starts its local API with a random internal token. To run the API package alone, set a token first:

```bash
export MAUZ_LOCAL_API_TOKEN="$(uuidgen)"
pnpm --filter @mauzai/api dev
```

`MAUZ_API_ALLOW_UNAUTHENTICATED=true` is only for isolated debugging.

Stop the macOS app without reinstalling with `pnpm stop:mac`.
