import { spawn } from "node:child_process";
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

export type TaskAgentLauncherOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  tempDirectory?: string;
  pathExists?: (path: string) => boolean;
  /** Starts a detached process; tests replace it. */
  startProcess?: (command: string, args: string[], options: StartProcessOptions) => Promise<void>;
};

export type StartProcessOptions = {
  env: NodeJS.ProcessEnv;
  windowsVerbatimArguments?: boolean;
};

export type LaunchTaskRequest = {
  agentId: TaskAgentId;
  folder: string;
  task: string;
  context: MauzDesktopContext;
};

/**
 * Send to agent: hands a task and the captured screen to a coding agent the user already
 * has (Hermes, Claude Code, Codex) by opening it in its own terminal window, in the chosen
 * folder. The agent runs with its own permissions; Mauz does not watch it afterwards.
 */
export class TaskAgentLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  private readonly temp: string;
  private readonly pathExists: (path: string) => boolean;
  private readonly startProcess: NonNullable<TaskAgentLauncherOptions["startProcess"]>;
  private readonly path: typeof posix;

  constructor(options: TaskAgentLauncherOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.home = options.homeDirectory ?? homedir();
    this.temp = options.tempDirectory ?? tmpdir();
    this.pathExists = options.pathExists ?? existsSync;
    this.startProcess = options.startProcess ?? startDetached;
    this.path = this.platform === "win32" ? win32 : posix;
  }

  listAgents(): TaskAgentStatus[] {
    return TASK_AGENTS.map((agent) => ({
      id: agent.id,
      label: agent.label,
      installed: this.findExecutable(agent.command) !== null
    }));
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

    if (agent === undefined || executable === null) {
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
    writeFileSync(briefPath, buildTaskBrief(request.task, request.context, screenshotPath), "utf8");

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

  private createHandoffDirectory(): string {
    const root = this.path.join(this.temp, "mauz-handoff");
    mkdirSync(root, { recursive: true });

    for (const name of listNames(root)) {
      const entry = this.path.join(root, name);

      if (Date.now() - modifiedAt(entry) > HANDOFF_RETENTION_MS) {
        rmSync(entry, { recursive: true, force: true });
      }
    }

    const directory = this.path.join(root, `${Date.now()}-${randomUUID().slice(0, 8)}`);
    mkdirSync(directory, { recursive: true });

    return directory;
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

/** The agent must not inherit Mauz's own secrets or Electron's run-as-Node switch. */
export function buildAgentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };

  for (const key of Object.keys(result)) {
    if (key.startsWith("MAUZ_") || key === "ELECTRON_RUN_AS_NODE") {
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

    child.once("error", (error) => reject(new Error(`Could not open a terminal: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
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
