# Design: Send to agent hands off to the agent's desktop app

**Date:** 2026-11-05
**Status:** Implemented for Windows (`apps/desktop/src/main/agent/TaskAgentLauncher.ts`, `codexAppServer.ts`)

## 1. Goal

Send to agent should never interrupt what is on screen. The task goes to the desktop app of
the chosen agent (Hermes, Claude, Codex) as a new thread that starts running in the
background. No terminal opens, no window appears, and focus stays where it was. The user
opens the agent's app later and finds the thread there, running or finished.

Before this change Mauz opened the agent's CLI in a visible PowerShell window.

## 2. How each agent gets its thread

- **Hermes:** Mauz runs the Hermes CLI hidden, as a one-off run. The Hermes app reads from
  the same local service, so the thread appears in its sidebar as a normal visible thread.
- **Claude:** Mauz runs Claude Code headless in the chosen folder, then hands the session to
  Claude desktop. Claude desktop gets a startup flag that keeps its window hidden, and the
  session appears in its Code list.
- **Codex:** Mauz creates the thread with the task queued on it, then sends a "wake" link
  that makes the Codex app run it. That link never shows the Codex window.

If Claude or Codex is closed, it starts hidden in the tray and runs the task. If an agent's
desktop app isn't installed, Mauz falls back to the terminal window. macOS still uses the
terminal.

## 3. Mechanics

All three first write the brief (`task.md`) and the screenshot to
`%TEMP%\mauz-handoff\<id>\`, as before. Console programs are started through
`cmd.exe /d /s /c "start "" /b <program> … >agent.log 2>&1"`, spawned with `windowsHide`:

- cmd gets a console with no window, and `start /b` hands that same console to the program,
  so neither the program nor anything it runs (shells, tools) opens a window.
- The program is cmd's child, not Mauz's, so it is outside the job object Node puts Mauz's
  children in and keeps running if Mauz quits or restarts.
- Output goes to `agent.log` in the hand-off folder.

### Hermes

```
hermes chat -Q --source cli --query-file task.md [--image screen.png] --in <folder>
```

- The Hermes CLI is a client of the local Hermes gateway (`hermes gateway run`), the same
  service the Hermes desktop app uses. The run executes in the gateway and the session is
  stored in `state.db`, so the app lists it.
- `-Q` is quiet, one-shot mode: it runs the turn and exits.
- One-shot runs are labelled `oneshot` by default, and the desktop sidebar hides that label.
  `--source cli` keeps the thread visible.
- If the gateway is not running, the CLI starts it hidden. The thread is there the next
  time the app opens.
- Detected by `Hermes.lnk` in the Start menu or the desktop build under
  `%LOCALAPPDATA%\hermes\hermes-agent\apps\desktop\release\win-unpacked\Hermes.exe`.

### Claude

```
claude -p --session-id <uuid> --permission-mode acceptEdits --add-dir <hand-off folder> --output-format json  < task.md
claude-desktop.exe --startup "claude://resume?session=<uuid>"
```

- The brief goes in on stdin, so it is the session's first message (and title) in the app.
  `--add-dir` lets Claude read the screenshot outside the project folder.
- Mauz picks the session id up front, waits until the transcript
  `~/.claude/projects/<project>/<uuid>.jsonl` exists (polled for up to two minutes), then
  sends the resume link through the app's execution alias.
- `claude://resume` makes Claude desktop import a CLI session into its Code list.
- `--startup` is the flag the app gets when it starts at sign-in. A running app skips
  showing and focusing its window, and a closed app starts hidden in the tray.
- Detected by the Store package folder
  `%LOCALAPPDATA%\Microsoft\WindowsApps\Claude_pzs8sxrjxfjjc`. The alias file itself is
  invisible to `fs.existsSync`, but it can be spawned.

### Codex

The Codex app runs its own private `codex app-server` and lists threads from `state_5.sqlite`.
Mauz uses the `codex.exe` bundled in the app package (found with
`Get-AppxPackage -Name OpenAI.Codex`). It needs the experimental thread-queue API
(`initialize` with `capabilities.experimentalApi: true`):

1. App-server A: `thread/start {cwd}`, then `thread/name/set` with a short title. Naming the
   thread writes it to disk.
2. App-server B: `thread/queue/add {threadId, input: [text: brief, localImage: screenshot]}`.
   This must be a separate process: on the server that has the thread loaded, queueing
   starts the turn right there, inside Mauz.
3. Open `codex://threads/wake/<threadId>`. The app resumes the thread, which runs the queued
   turn. Wake links never create or focus a window, even when they start the app.

- Threads made through an app-server are labelled `vscode` and appear in the sidebar.
  Threads from `codex exec` are labelled `exec` and are hidden there, which is why Mauz
  doesn't use `codex exec`.
- The image is stored inline in the queue, so the screenshot file can be deleted later.
- Detected by the Store package folder
  `%LOCALAPPDATA%\Microsoft\WindowsApps\OpenAI.Codex_2p2nqsd0c76g0`. The app alone counts
  as Codex being installed; the `codex` CLI is not needed.

## 4. Permissions

Mauz still does not handle approvals; each agent applies its own.

- **Claude:** a headless run can't stop to ask, so Mauz lets it edit files in the chosen
  folder (`--permission-mode acceptEdits`). Anything else that needs approval, such as
  shell commands not already allowed, is refused rather than asked.
- **Codex:** the thread uses the Codex app's own defaults, which on the test machine were
  "ask before acting" with a read-only sandbox. Settings passed to `thread/start` do not
  survive the app's resume. Any approval prompt waits in that thread in the app.
- **Hermes:** dangerous commands are refused by default in one-off runs
  (`approvals.single_query_mode: deny`). Hermes' `--yolo` flag would auto-approve
  everything; Mauz does not pass it.

## 5. Known limits

- **Claude hand-off timing:** Claude desktop picks up the session as soon as Claude Code
  starts writing it. If the user replies in Claude desktop while the background run is still
  going, both write to the same session. If the Claude window happens to be open, it may
  switch to the new session, but it won't come to the front.
- **Fragility:** the Codex wake link and Claude's hidden-startup flag are undocumented parts
  of those apps, so an app update could break them. Both were read from the shipped app
  code (Claude 4.16336.0, Codex 26.1029.7803.0, bundled `codex-cli 0.166.0-alpha.6`).
- Mauz does not see the result. If an agent fails to start, the reason is in `agent.log` in
  the hand-off folder, which is deleted after a day.

## 6. Verification

On Windows 11 with all three apps installed:

- Each hand-off ran through `TaskAgentLauncher.launch()` while a script reported every new
  top-level window and every change of foreground window. No window from Mauz or the agents
  appeared.
- Hermes: the session is in `state.db` with `created_source = cli` and `hidden = 0`.
- Claude: a `local_<uuid>.json` record appeared in Claude desktop's session store.
- Codex: the turn ran to `task_complete` inside the app.
- Claude and Codex were tested both while closed (they started hidden) and while running.
