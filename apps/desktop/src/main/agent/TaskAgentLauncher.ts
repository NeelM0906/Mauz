import { execFile, spawn } from "node:child_process";
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
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import {
  buildTaskBrief,
  getContextImage,
  type MauzDesktopContext,
  type TaskAgentId,
  type TaskAgentPreference,
  type TaskAgentStatus,
  type TaskFolder
} from "@mauzai/shared";
import { type CodexThreadRequest, queueCodexThread } from "./codexAppServer";

type AgentDefinition = {
  id: TaskAgentId;
  label: string;
  command: string;
};

/** In "auto" order: the first installed agent is the default. */
export const TASK_AGENTS: readonly AgentDefinition[] = [
  { id: "hermes", label: "Hermes", command: "hermes" },
  { id: "claude-code", label: "Claude Code", command: "claude" },
  { id: "codex", label: "Codex", command: "codex" }
];

const MAX_FOLDERS = 30;
const MAX_CODEX_SESSIONS = 300;
const HANDOFF_RETENTION_MS = 24 * 60 * 60 * 1000;
const HANDOFF_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const CLAUDE_TRANSCRIPT_POLL_MS = 1_000;
const CLAUDE_TRANSCRIPT_POLLS = 120;
const MAX_THREAD_TITLE = 60;
// Windows Store package family names of the desktop apps.
const CLAUDE_PACKAGE_FAMILY = "Claude_pzs8sxrjxfjjc";
const CODEX_PACKAGE_FAMILY = "OpenAI.Codex_2p2nqsd0c76g0";

type DesktopHandoff = {
  folder: string;
  task: string;
  brief: string;
  briefPath: string;
  screenshotPath: string | undefined;
  handoffDirectory: string;
};

export type TaskAgentLauncherOptions = {
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

export type StartProcessOptions = {
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
};

export type StartHiddenOptions = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  logPath: string;
  stdinPath?: string;
};

export type LaunchTaskRequest = {
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
    this.temp = options.tempDirectory ?? tmpdir();
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

  async launch(request: LaunchTaskRequest): Promise<{ agentLabel: string }> {
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
    const brief = buildTaskBrief(request.task, request.context, screenshotPath);
    writeFileSync(briefPath, brief, "utf8");

    if (hasDesktopApp) {
      const handoff = {
        folder: request.folder,
        task: request.task,
        brief,
        briefPath,
        screenshotPath,
        handoffDirectory
      };

      if (agent.id === "codex") {
        const codexExecutable = await this.findCodexAppExecutable();

        if (codexExecutable !== null) {
          await this.startInCodexApp(codexExecutable, handoff);
          return { agentLabel: agent.label };
        }
      } else if (executable !== null) {
        await (agent.id === "hermes"
          ? this.startInHermesApp(executable, handoff)
          : this.startInClaudeApp(executable, handoff));
        return { agentLabel: agent.label };
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

    return { agentLabel: agent.label };
  }

  findExecutable(command: string): string | null {
    const extensions = this.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""];

    for (const directory of this.searchDirectories()) {
      for (const extension of extensions) {
        const candidate = this.path.join(directory, `${command}${extension}`);

        if (this.pathExists(candidate)) {
          return candidate;
        }
      }
    }

    return null;
  }

  private searchDirectories(): string[] {
    const separator = this.platform === "win32" ? ";" : ":";
    const pathValue = this.env.PATH ?? this.env.Path ?? "";
    const fromPath = pathValue
      .split(separator)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
      .filter((entry) => entry.length > 0);
    const join = this.path.join;
    // GUI launches (Start menu, Finder) can miss the shell's PATH additions.
    const extra =
      this.platform === "win32"
        ? [
            join(this.home, ".local", "bin"),
            ...(this.env.APPDATA === undefined ? [] : [join(this.env.APPDATA, "npm")]),
            ...(this.env.LOCALAPPDATA === undefined ? [] : [join(this.env.LOCALAPPDATA, "hermes", "bin")])
          ]
        : [
            join(this.home, ".local", "bin"),
            join(this.home, ".npm-global", "bin"),
            join(this.home, ".hermes", "bin"),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin"
          ];

    return [...fromPath, ...extra];
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
   * Claude: a headless Claude Code run, hidden, then the session is handed to Claude desktop's
   * Code list with `claude://resume`. `--startup` keeps the app's window hidden: it is the
   * flag the app uses when it starts at sign-in.
   */
  private async startInClaudeApp(executable: string, handoff: DesktopHandoff): Promise<void> {
    const sessionId = randomUUID();

    await this.startHidden(
      executable,
      [
        "-p",
        "--session-id",
        sessionId,
        // Headless runs cannot ask, so let it edit files in the folder; other tools stay denied.
        "--permission-mode",
        "acceptEdits",
        // The screenshot sits outside the project folder.
        "--add-dir",
        handoff.handoffDirectory,
        "--output-format",
        "json"
      ],
      {
        env: buildAgentEnvironment(this.env),
        cwd: handoff.folder,
        logPath: this.path.join(handoff.handoffDirectory, "agent.log"),
        // The brief is the prompt, so it is the session's first message in the app.
        stdinPath: handoff.briefPath
      }
    );

    const followUp = this.importClaudeSession(sessionId).finally(() => this.followUps.delete(followUp));
    this.followUps.add(followUp);
  }

  /** The app can only import the session once Claude Code has written its transcript. */
  private async importClaudeSession(sessionId: string): Promise<void> {
    const projectsDirectory = this.path.join(this.home, ".claude", "projects");
    const transcript = `${sessionId}.jsonl`;

    for (let attempt = 0; attempt < CLAUDE_TRANSCRIPT_POLLS; attempt += 1) {
      await this.sleep(CLAUDE_TRANSCRIPT_POLL_MS);

      const found = listNames(projectsDirectory).some((project) =>
        this.pathExists(this.path.join(projectsDirectory, project, transcript))
      );

      if (found) {
        try {
          await this.startProcess(
            this.path.join(this.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "claude-desktop.exe"),
            ["--startup", `claude://resume?session=${sessionId}`],
            { env: buildAgentEnvironment(this.env) }
          );
        } catch {
          // The run itself carries on; the session can still be resumed from the CLI.
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

export function buildAgentArguments(
  agentId: TaskAgentId,
  input: { folder: string; briefPath: string; handoffDirectory: string; screenshotPath?: string | undefined }
): string[] {
  const prompt = `Read the task brief in ${input.briefPath} and carry it out.`;

  if (agentId === "hermes") {
    return [
      "chat",
      "--query-file",
      input.briefPath,
      ...(input.screenshotPath === undefined ? [] : ["--image", input.screenshotPath]),
      "--in",
      input.folder
    ];
  }

  if (agentId === "codex") {
    // -i takes several files, so the prompt goes before it.
    return [
      "-C",
      input.folder,
      prompt,
      ...(input.screenshotPath === undefined ? [] : ["-i", input.screenshotPath])
    ];
  }

  // Claude Code may read the brief and screenshot outside the project folder.
  return ["--add-dir", input.handoffDirectory, prompt];
}

export function buildPowerShellLauncher(launch: {
  title: string;
  folder: string;
  executable: string;
  args: string[];
}): string {
  // PowerShell also ends a single-quoted string at curly single quotes, so double those too.
  const quote = (value: string): string => `'${value.replace(/['‘’‚‛]/g, "$&$&")}'`;

  return [
    `$Host.UI.RawUI.WindowTitle = ${quote(launch.title)}`,
    `Set-Location -LiteralPath ${quote(launch.folder)}`,
    `& ${[launch.executable, ...launch.args].map(quote).join(" ")}`,
    ""
  ].join("\r\n");
}

export function buildShellLauncher(launch: { folder: string; executable: string; args: string[] }): string {
  const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

  return [
    "#!/bin/bash",
    `cd ${quote(launch.folder)} || exit 1`,
    [launch.executable, ...launch.args].map(quote).join(" "),
    ""
  ].join("\n");
}

/** Variables Mauz sets from its own settings (applyRuntimeEnvironment); agents use their own. */
const MAUZ_RUNTIME_VARIABLES = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_ASK_MODEL"]);

/** The agent must not inherit Mauz's own secrets or Electron's run-as-Node switch. */
export function buildAgentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };

  for (const key of Object.keys(result)) {
    if (
      key.startsWith("MAUZ_") ||
      key === "ELECTRON_RUN_AS_NODE" ||
      MAUZ_RUNTIME_VARIABLES.has(key.toUpperCase())
    ) {
      delete result[key];
    }
  }

  return result;
}

function startDetached(command: string, args: string[], options: StartProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: options.env,
      ...(options.windowsVerbatimArguments === true ? { windowsVerbatimArguments: true } : {})
    });

    child.once("error", (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

/**
 * The cmd.exe arguments that start a program in the background with its output in a log.
 * cmd runs with no console window, and `start /b` gives the program that same windowless
 * console, so neither it nor anything it runs opens a window. Started by cmd rather than by
 * Mauz, the program is outside Mauz's process job and keeps running if Mauz quits.
 */
export function buildHiddenStartCommand(
  executable: string,
  args: string[],
  io: { logPath: string; stdinPath?: string | undefined }
): string {
  const quote = (value: string): string => {
    if (value.includes('"')) {
      throw new Error(`Mauz cannot pass ${value} to the agent.`);
    }

    return `"${value}"`;
  };
  const input = io.stdinPath === undefined ? "" : ` <${quote(io.stdinPath)}`;

  return `/d /s /c "start "" /b ${[executable, ...args].map(quote).join(" ")}${input} >${quote(io.logPath)} 2>&1"`;
}

function startHiddenProcess(command: string, args: string[], options: StartHiddenOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("cmd.exe", [buildHiddenStartCommand(command, args, options)], {
      cwd: options.cwd,
      env: options.env,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true
    });

    child.once("error", (error) => reject(new Error(`Could not start the agent: ${error.message}`)));
    // cmd exits as soon as the program has started.
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Could not start the agent (exit code ${code ?? "unknown"}).`))
    );
  });
}

/** The package folder name holds the version, so ask Windows where the Codex app lives. */
function findCodexAppExecutable(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name OpenAI.Codex).InstallLocation"],
      { windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        const location = error === null ? stdout.trim().split(/\r?\n/)[0]?.trim() : undefined;
        const executable =
          location === undefined || location.length === 0
            ? null
            : win32.join(location, "app", "resources", "codex.exe");

        resolve(executable !== null && existsSync(executable) ? executable : null);
      }
    );
  });
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
