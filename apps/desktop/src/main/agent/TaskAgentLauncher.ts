import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import { applyCliPathOverride, getCliSearchDirectories } from "@mauzai/api/server";
import {
  buildTaskBrief,
  getContextImage,
  type MauzDesktopContext,
  type TaskAgentId,
  type TaskAgentPreference,
  type TaskAgentStatus,
  type TaskFolder
} from "@mauzai/shared";
import {
  buildAgentArguments,
  buildAgentEnvironment,
  buildPowerShellLauncher,
  buildShellLauncher,
  findCodexAppExecutable,
  startDetached,
  startHiddenProcess,
  type StartHiddenOptions,
  type StartProcessOptions
} from "./agentProcess";
import { type CodexThreadRequest, queueCodexThread } from "./codexAppServer";

type AgentDefinition = {
  id: TaskAgentId;
  label: string;
  command: string;
};

/** In "auto" order: the first installed agent is the default. */
const TASK_AGENTS: readonly AgentDefinition[] = [
  { id: "hermes", label: "Hermes", command: "hermes" },
  { id: "claude-code", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" }
];

const MAX_FOLDERS = 30;
const MAX_CODEX_SESSIONS = 300;
const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;
const HANDOFF_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLAUDE_POLL_MS = 2_000;
// Three hours. A longer task still runs to the end, but it is not added to Claude desktop.
const CLAUDE_POLLS = 3 * 60 * 30;
const CLAUDE_LOG_TAIL_BYTES = 65_536;
const MAX_THREAD_TITLE = 60;
// Windows Store package family names of the desktop apps.
const CLAUDE_PACKAGE_FAMILY = "Claude_pzs8sxrjxfjjc";
const CODEX_PACKAGE_FAMILY = "OpenAI.Codex_2p2nqsd0c76g0";
// The values `claude --permission-mode` accepts. Settings files store "default"; "manual" is its alias.
const CLAUDE_PERMISSION_MODES = new Set([
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "default",
  "dontAsk",
  "manual",
  "plan"
]);

type DesktopHandoff = {
  folder: string;
  task: string;
  brief: string;
  briefPath: string;
  screenshotPath: string | undefined;
  image: { base64: string; mimeType: string } | undefined;
  handoffDirectory: string;
};

type TaskAgentLauncherOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  tempDirectory?: string;
  pathExists?: (path: string) => boolean;
  /** Starts a detached process; tests replace it. */
  startProcess?: (command: string, args: string[], options: StartProcessOptions) => Promise<void>;
  /** Windows: starts a console program with no window that keeps running after Mauz quits. */
  startHidden?: (command: string, args: string[], options: StartHiddenOptions) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  /** Windows: codex.exe inside the Codex desktop app package, or null. */
  findCodexAppExecutable?: () => Promise<string | null>;
  queueCodexThread?: (codexExecutable: string, request: CodexThreadRequest) => Promise<string>;
  sleep?: (milliseconds: number) => Promise<void>;
};

type LaunchTaskRequest = {
  agentId: TaskAgentId;
  folder: string;
  task: string;
  context: MauzDesktopContext;
};

/**
 * Send to agent: hands a task and the captured screen to a coding agent the user already
 * has (Hermes, Claude Code, Codex), in the chosen folder. On Windows, when the agent's
 * desktop app is installed, the task starts as a new thread in that app, in the background:
 * no window opens and focus stays where it is. Otherwise the agent opens in its own terminal
 * window. The agent runs with its own permissions; Mauz does not watch it afterwards.
 */
export class TaskAgentLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  private readonly temp: string;
  private readonly pathExists: (path: string) => boolean;
  private readonly startProcess: NonNullable<TaskAgentLauncherOptions["startProcess"]>;
  private readonly startHidden: NonNullable<TaskAgentLauncherOptions["startHidden"]>;
  private readonly openExternal: NonNullable<TaskAgentLauncherOptions["openExternal"]>;
  private readonly findCodexAppExecutable: NonNullable<TaskAgentLauncherOptions["findCodexAppExecutable"]>;
  private readonly queueCodexThread: NonNullable<TaskAgentLauncherOptions["queueCodexThread"]>;
  private readonly sleep: NonNullable<TaskAgentLauncherOptions["sleep"]>;
  private readonly path: typeof posix;
  private readonly followUps = new Set<Promise<void>>();

  constructor(options: TaskAgentLauncherOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.home = options.homeDirectory ?? homedir();
    // Windows TEMP is often a short 8.3 path (SAUDAM~1), which Claude Code refuses to read.
    this.temp = options.tempDirectory ?? realpathSync.native(tmpdir());
    this.pathExists = options.pathExists ?? existsSync;
    this.startProcess = options.startProcess ?? startDetached;
    this.startHidden = options.startHidden ?? startHiddenProcess;
    this.openExternal =
      options.openExternal ??
      ((url) => this.startProcess("rundll32.exe", ["url.dll,FileProtocolHandler", url], { env: this.env }));
    this.findCodexAppExecutable = options.findCodexAppExecutable ?? findCodexAppExecutable;
    this.queueCodexThread = options.queueCodexThread ?? queueCodexThread;
    this.sleep =
      options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.path = this.platform === "win32" ? win32 : posix;
  }

  listAgents(): TaskAgentStatus[] {
    return TASK_AGENTS.map((agent) => ({
      id: agent.id,
      label: agent.label,
      // The Codex desktop app brings its own codex.exe.
      installed:
        this.findExecutable(agent.command) !== null || (agent.id === "codex" && this.hasDesktopApp("codex"))
    }));
  }

  /** Resolves once background work from earlier launches (Claude session imports) is done. */
  async settled(): Promise<void> {
    await Promise.all([...this.followUps]);
  }

  /** The agent Send to agent uses: the chosen one if installed, else the first installed one. */
  resolveAgent(preference: TaskAgentPreference, agents = this.listAgents()): TaskAgentId | null {
    const installed = agents.filter((agent) => agent.installed);

    return (installed.find((agent) => agent.id === preference) ?? installed[0])?.id ?? null;
  }

  /** Folders the agent has worked in, most recent first. */
  listFolders(agentId: TaskAgentId): TaskFolder[] {
    let found: Array<{ path: string; lastUsed: number }>;

    try {
      found =
        agentId === "claude-code"
          ? this.claudeCodeFolders()
          : agentId === "codex"
            ? this.codexFolders()
            : this.hermesFolders();
    } catch {
      found = [];
    }

    const seen = new Set<string>();
    const folders: TaskFolder[] = [];

    for (const entry of found.sort((a, b) => b.lastUsed - a.lastUsed)) {
      const key = this.folderKey(entry.path);

      if (seen.has(key) || !this.pathExists(entry.path)) {
        continue;
      }

      seen.add(key);
      folders.push(this.toTaskFolder(entry.path));

      if (folders.length >= MAX_FOLDERS) {
        break;
      }
    }

    return folders;
  }

  toTaskFolder(path: string): TaskFolder {
    return { path, name: this.path.basename(path) || path };
  }

  folderKey(path: string): string {
    const normalized = path.replace(/[\\/]+$/, "");

    return this.platform === "win32" ? normalized.replace(/\//g, "\\").toLowerCase() : normalized;
  }

  defaultFolder(configured: string): string {
    const trimmed = configured.trim();

    return trimmed.length > 0 ? trimmed : this.home;
  }

  async launch(request: LaunchTaskRequest): Promise<void> {
    const agent = TASK_AGENTS.find((candidate) => candidate.id === request.agentId);
    const executable = agent === undefined ? null : this.findExecutable(agent.command);
    const hasDesktopApp = agent !== undefined && this.hasDesktopApp(agent.id);

    if (agent === undefined || (executable === null && !(agent.id === "codex" && hasDesktopApp))) {
      throw new Error(`${agent?.label ?? "That agent"} is not installed on this computer.`);
    }

    if (!this.pathExists(request.folder)) {
      throw new Error(`The folder ${request.folder} no longer exists. Pick another one.`);
    }

    const handoffDirectory = this.createHandoffDirectory();
    const image = getContextImage(request.context);
    let screenshotPath: string | undefined;

    if (image !== undefined) {
      screenshotPath = this.path.join(
        handoffDirectory,
        image.payload.mimeType === "image/png" ? "screen.png" : "screen.jpg"
      );
      writeFileSync(screenshotPath, Buffer.from(image.payload.base64, "base64"));
    }

    const briefPath = this.path.join(handoffDirectory, "task.md");
    // Every agent gets the screenshot attached to the prompt, so the brief only describes it.
    const brief = buildTaskBrief(request.task, request.context);
    writeFileSync(briefPath, brief, "utf8");

    if (hasDesktopApp) {
      const handoff = {
        folder: request.folder,
        task: request.task,
        brief,
        briefPath,
        screenshotPath,
        image: image?.payload,
        handoffDirectory
      };

      if (agent.id === "codex") {
        const codexExecutable = await this.findCodexAppExecutable();

        if (codexExecutable !== null) {
          await this.startInCodexApp(codexExecutable, handoff);
          return;
        }
      } else if (executable !== null) {
        await (agent.id === "hermes"
          ? this.startInHermesApp(executable, handoff)
          : this.startInClaudeApp(executable, handoff));
        return;
      }
    }

    if (executable === null) {
      throw new Error(`${agent.label} is not installed on this computer.`);
    }

    const args = buildAgentArguments(agent.id, {
      folder: request.folder,
      briefPath,
      handoffDirectory,
      screenshotPath
    });

    await this.openTerminal({
      title: `Mauz → ${agent.label}`,
      folder: request.folder,
      executable,
      args,
      handoffDirectory
    });
  }

  /**
   * The same folders and MAUZ_*_PATH overrides as Ask. Unlike Ask, a Windows `.cmd` shim is
   * returned as it is: the agent starts through a terminal or cmd.exe, which can run it.
   */
  findExecutable(command: string): string | null {
    const name = applyCliPathOverride(command, this.env);

    if (this.path.isAbsolute(name)) {
      return this.pathExists(name) ? name : null;
    }

    const extensions = this.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];

    for (const directory of getCliSearchDirectories(this.platform, this.env, this.home)) {
      for (const extension of extensions) {
        const candidate = this.path.join(directory, `${name}${extension}`);

        if (this.pathExists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  /** Claude Code lists every folder it has opened in ~/.claude.json. */
  private claudeCodeFolders(): Array<{ path: string; lastUsed: number }> {
    const configPath = this.path.join(this.home, ".claude.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { projects?: Record<string, unknown> };
    const projectsDirectory = this.path.join(this.home, ".claude", "projects");

    return Object.keys(config.projects ?? {})
      .filter((path) => !/[\\/]\.claude[\\/]worktrees[\\/]/.test(path))
      .map((path) => {
        const nativePath = this.platform === "win32" ? path.replace(/\//g, "\\") : path;
        // Session transcripts live in a folder named after the path; its age says when it was last used.
        const sessions = this.path.join(projectsDirectory, path.replace(/[^a-zA-Z0-9]/g, "-"));

        return { path: nativePath, lastUsed: modifiedAt(sessions) };
      });
  }

  /** Codex records each session's working folder in the first line of its transcript. */
  private codexFolders(): Array<{ path: string; lastUsed: number }> {
    const sessionsRoot = this.path.join(this.home, ".codex", "sessions");
    const files: string[] = [];

    for (const year of listNames(sessionsRoot).sort().reverse()) {
      for (const month of listNames(this.path.join(sessionsRoot, year)).sort().reverse()) {
        for (const day of listNames(this.path.join(sessionsRoot, year, month))
          .sort()
          .reverse()) {
          const dayDirectory = this.path.join(sessionsRoot, year, month, day);

          for (const name of listNames(dayDirectory).sort().reverse()) {
            if (name.endsWith(".jsonl")) {
              files.push(this.path.join(dayDirectory, name));
            }
          }

          if (files.length >= MAX_CODEX_SESSIONS) {
            break;
          }
        }
      }
    }

    return files.slice(0, MAX_CODEX_SESSIONS).flatMap((file) => {
      const cwd = readCodexSessionFolder(file);

      return cwd === null ? [] : [{ path: cwd, lastUsed: modifiedAt(file) }];
    });
  }

  /** Hermes keeps named projects, each with one or more folders, in projects.db. */
  private hermesFolders(): Array<{ path: string; lastUsed: number }> {
    const hermesHome =
      this.env.HERMES_HOME ??
      (this.platform === "win32" && this.env.LOCALAPPDATA !== undefined
        ? this.path.join(this.env.LOCALAPPDATA, "hermes")
        : this.path.join(this.home, ".hermes"));
    const databasePath = this.path.join(hermesHome, "projects.db");

    if (!this.pathExists(databasePath)) {
      return [];
    }

    const sqlite = process.getBuiltinModule("node:sqlite");
    const database = new sqlite.DatabaseSync(databasePath, { readOnly: true });

    try {
      const rows = database
        .prepare(
          "SELECT f.path AS path, f.added_at AS addedAt FROM project_folders f JOIN projects p ON p.id = f.project_id WHERE p.archived = 0"
        )
        .all() as Array<{ path: unknown; addedAt: unknown }>;

      return rows.flatMap((row) =>
        typeof row.path === "string" ? [{ path: row.path, lastUsed: Number(row.addedAt) || 0 }] : []
      );
    } finally {
      database.close();
    }
  }

  /** Deletes hand-off folders (brief, screenshot) older than a day. */
  removeExpiredHandoffs(now = Date.now()): void {
    const root = this.path.join(this.temp, "mauz-handoff");

    for (const name of listNames(root)) {
      const entry = this.path.join(root, name);

      if (now - modifiedAt(entry) > HANDOFF_RETENTION_MS) {
        rmSync(entry, { recursive: true, force: true });
      }
    }
  }

  /** Cleans up now and every hour, so a single hand-off is not kept past a day. Returns a stop function. */
  startHandoffCleanup(): () => void {
    this.removeExpiredHandoffs();

    const timer = setInterval(() => this.removeExpiredHandoffs(), HANDOFF_CLEANUP_INTERVAL_MS);
    timer.unref();

    return () => clearInterval(timer);
  }

  private createHandoffDirectory(): string {
    const root = this.path.join(this.temp, "mauz-handoff");
    mkdirSync(root, { recursive: true });
    this.removeExpiredHandoffs();

    const directory = this.path.join(root, `${Date.now()}-${randomUUID().slice(0, 8)}`);
    mkdirSync(directory, { recursive: true });

    return directory;
  }

  /** Windows only: whether the agent's desktop app is installed, so tasks can go to it. */
  hasDesktopApp(agentId: TaskAgentId): boolean {
    const localAppData = this.env.LOCALAPPDATA;
    const appData = this.env.APPDATA;

    if (this.platform !== "win32" || localAppData === undefined) {
      return false;
    }

    const join = this.path.join;

    if (agentId === "hermes") {
      return (
        (appData !== undefined &&
          this.pathExists(join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Hermes.lnk"))) ||
        this.pathExists(
          join(
            localAppData,
            "hermes",
            "hermes-agent",
            "apps",
            "desktop",
            "release",
            "win-unpacked",
            "Hermes.exe"
          )
        )
      );
    }

    // Store apps: the alias files themselves are invisible to stat, their package folders are not.
    const packageFamily = agentId === "codex" ? CODEX_PACKAGE_FAMILY : CLAUDE_PACKAGE_FAMILY;

    return this.pathExists(join(localAppData, "Microsoft", "WindowsApps", packageFamily));
  }

  /**
   * Hermes: a one-shot CLI run, hidden. The CLI hands the turn to the local Hermes gateway the
   * desktop app also uses, so the thread shows up in the app. `--source cli` keeps it in the
   * sidebar; one-shot runs are otherwise labelled `oneshot` and hidden there.
   */
  private async startInHermesApp(executable: string, handoff: DesktopHandoff): Promise<void> {
    await this.startHidden(
      executable,
      [
        "chat",
        "-Q",
        "--source",
        "cli",
        "--query-file",
        handoff.briefPath,
        ...(handoff.screenshotPath === undefined ? [] : ["--image", handoff.screenshotPath]),
        "--in",
        handoff.folder
      ],
      {
        env: buildAgentEnvironment(this.env),
        cwd: handoff.folder,
        logPath: this.path.join(handoff.handoffDirectory, "agent.log")
      }
    );
  }

  /**
   * Claude: a headless Claude Code run, hidden, then the finished session is handed to Claude
   * desktop's Code list with `claude://resume`. `--startup` keeps the app's window hidden: it is
   * the flag the app uses when it starts at sign-in.
   */
  private async startInClaudeApp(executable: string, handoff: DesktopHandoff): Promise<void> {
    const sessionId = randomUUID();
    const promptPath = this.path.join(handoff.handoffDirectory, "prompt.jsonl");
    const logPath = this.path.join(handoff.handoffDirectory, "agent.log");
    // One user message: the brief with the screenshot attached. It is the session's first message in the app.
    const message = {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "text", text: handoff.brief },
          ...(handoff.image === undefined
            ? []
            : [
                {
                  type: "image",
                  source: { type: "base64", media_type: handoff.image.mimeType, data: handoff.image.base64 }
                }
              ])
        ]
      }
    };
    writeFileSync(promptPath, `${JSON.stringify(message)}\n`, "utf8");

    await this.startHidden(
      executable,
      [
        "-p",
        "--session-id",
        sessionId,
        "--permission-mode",
        this.claudePermissionMode(handoff.folder),
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose"
      ],
      { env: buildAgentEnvironment(this.env), cwd: handoff.folder, logPath, stdinPath: promptPath }
    );

    const followUp = this.importClaudeSession(sessionId, logPath).finally(() =>
      this.followUps.delete(followUp)
    );
    this.followUps.add(followUp);
  }

  /**
   * The mode the user picked for this folder in Claude desktop, else Claude Code's default mode,
   * else auto: a headless run cannot ask, so manual mode would deny every command.
   */
  claudePermissionMode(folder: string): string {
    // shortcut: reads Claude desktop's undocumented preference key; update it if the app renames it.
    const desktopConfig = readJson(
      this.path.join(
        this.env.LOCALAPPDATA ?? "",
        "Claude-Data",
        CLAUDE_PACKAGE_FAMILY.toLowerCase(),
        "claude_desktop_config.json"
      )
    ) as { preferences?: { epitaxyPrefs?: Record<string, unknown> } } | null;
    const key = this.folderKey(folder);
    const desktopMode = Object.entries(desktopConfig?.preferences?.epitaxyPrefs ?? {})
      .filter(([name]) => name.startsWith("epitaxy-folder-permission-mode-v2."))
      .flatMap(([, folders]) => Object.entries((folders ?? {}) as Record<string, unknown>))
      .find(([path]) => this.folderKey(path) === key)?.[1];
    const cliSettings = readJson(this.path.join(this.home, ".claude", "settings.json")) as {
      permissions?: { defaultMode?: unknown };
    } | null;

    return (
      [desktopMode, cliSettings?.permissions?.defaultMode].find(
        (mode): mode is string => typeof mode === "string" && CLAUDE_PERMISSION_MODES.has(mode)
      ) ?? "auto"
    );
  }

  /**
   * The app reads an imported session once and does not follow later writes, so the session is
   * imported when the run has ended (its result is the last line of the log) and shows the answer.
   */
  private async importClaudeSession(sessionId: string, logPath: string): Promise<void> {
    for (let attempt = 0; attempt < CLAUDE_POLLS; attempt += 1) {
      await this.sleep(CLAUDE_POLL_MS);

      if (readTail(logPath, CLAUDE_LOG_TAIL_BYTES).includes('"type":"result"')) {
        try {
          await this.startProcess(
            this.path.join(this.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "claude-desktop.exe"),
            ["--startup", `claude://resume?session=${sessionId}`],
            { env: buildAgentEnvironment(this.env) }
          );
        } catch {
          // The work is done either way; the session can still be resumed from the CLI.
        }

        return;
      }
    }
  }

  /**
   * Codex: the thread is created with the task queued on it, then the wake link makes the
   * Codex desktop app run it. Wake links never show the app's window, even when it starts.
   */
  private async startInCodexApp(codexExecutable: string, handoff: DesktopHandoff): Promise<void> {
    const threadId = await this.queueCodexThread(codexExecutable, {
      folder: handoff.folder,
      title: threadTitle(handoff.task),
      text: handoff.brief,
      imagePath: handoff.screenshotPath,
      env: buildAgentEnvironment(this.env)
    });

    await this.openExternal(`codex://threads/wake/${threadId}`);
  }

  private async openTerminal(launch: {
    title: string;
    folder: string;
    executable: string;
    args: string[];
    handoffDirectory: string;
  }): Promise<void> {
    const env = buildAgentEnvironment(this.env);

    if (this.platform === "win32") {
      const scriptPath = this.path.join(launch.handoffDirectory, "launch.ps1");
      // Windows PowerShell 5.1 reads a script without a BOM as the ANSI code page, which turns
      // the "→" in the title into bytes that include a curly quote and breaks the string.
      writeFileSync(scriptPath, `﻿${buildPowerShellLauncher(launch)}`, "utf8");
      // `start` gives PowerShell its own console window (Windows Terminal when that is the default).
      await this.startProcess(
        "cmd.exe",
        [
          `/d /c start "Mauz" powershell.exe -NoProfile -ExecutionPolicy Bypass -NoExit -File "${scriptPath}"`
        ],
        { env, windowsVerbatimArguments: true }
      );
      return;
    }

    const scriptPath = this.path.join(launch.handoffDirectory, "launch.command");
    writeFileSync(scriptPath, buildShellLauncher(launch), "utf8");
    chmodSync(scriptPath, 0o755);

    if (this.platform === "darwin") {
      await this.startProcess("open", ["-a", "Terminal", scriptPath], { env });
      return;
    }

    await this.startProcess("x-terminal-emulator", ["-e", scriptPath], { env });
  }
}

/** A short thread name from the first line of the task. */
export function threadTitle(task: string): string {
  const firstLine = task.trim().split(/\r?\n/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  const title = firstLine.length > 0 ? firstLine : "Task from Mauz";

  return title.length > MAX_THREAD_TITLE ? `${title.slice(0, MAX_THREAD_TITLE - 1).trimEnd()}…` : title;
}

function listNames(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** The last `bytes` of a file as text, or "" when it cannot be read. */
function readTail(path: string, bytes: number): string {
  let descriptor: number | undefined;

  try {
    descriptor = openSync(path, "r");
    const size = statSync(path).size;
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    readSync(descriptor, buffer, 0, length, size - length);

    return buffer.toString("utf8");
  } catch {
    return "";
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function modifiedAt(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function readCodexSessionFolder(file: string): string | null {
  let descriptor: number | undefined;

  try {
    descriptor = openSync(file, "r");
    const buffer = Buffer.alloc(16_384);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    const firstLine = buffer.subarray(0, length).toString("utf8").split("\n")[0] ?? "";
    const match = /"cwd":("(?:[^"\\]|\\.)*")/.exec(firstLine);

    return match?.[1] === undefined ? null : (JSON.parse(match[1]) as string);
  } catch {
    return null;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}
