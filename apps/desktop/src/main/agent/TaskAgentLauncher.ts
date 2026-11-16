import { randomUUID } from "node:crypto";
import {
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
import { resolveCliCommand, type ResolvedCliCommand } from "@mauzai/api/server";
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
  buildAgentEnvironment,
  findCodexAppExecutable,
  readAgentOutput,
  startDetached,
  startHiddenProcess,
  type StartHiddenOptions,
  type StartProcessOptions
} from "./agentProcess";
import { type CodexThreadRequest, queueCodexThread } from "./codexAppServer";
import { submitHermesTask, type HermesTaskRequest } from "./hermesGateway";

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
const MAX_THREAD_TITLE = 60;
const MAX_CLAUDE_DESKTOP_URL_LENGTH = 8_000;
// Windows Store package family names of the desktop apps.
const CLAUDE_PACKAGE_FAMILY = "Claude_pzs8sxrjxfjjc";
const CODEX_PACKAGE_FAMILY = "OpenAI.Codex_2p2nqsd0c76g0";
const DESKTOP_APPS = {
  codex: { scheme: "codex", names: ["ChatGPT", "Codex"] },
  "claude-code": { scheme: "claude", names: ["Claude"] },
  hermes: { scheme: "hermes", names: ["Hermes", "Hermes Desktop"] }
} as const;

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
  /** Starts a non-interactive process with its output in the handoff log. */
  startHidden?: (command: string, args: string[], options: StartHiddenOptions) => Promise<void>;
  openExternal?: (url: string) => Promise<void>;
  openMacApplication?: (bundle: string, url: string) => Promise<void>;
  findProtocolApp?: (scheme: string) => Promise<string | undefined>;
  /** Windows: codex.exe inside the Codex desktop app package, or null. */
  findCodexAppExecutable?: () => Promise<string | null>;
  queueCodexThread?: (codexExecutable: string, request: CodexThreadRequest) => Promise<string>;
  readAgentOutput?: typeof readAgentOutput;
  submitHermesTask?: (request: HermesTaskRequest) => Promise<string>;
};

type LaunchTaskRequest = {
  agentId: TaskAgentId;
  folder: string;
  task: string;
  context: MauzDesktopContext;
};

/** Routes Send to agent to a live desktop session or a windowless CLI. */
export class TaskAgentLauncher {
  private readonly platform: NodeJS.Platform;
  private readonly env: NodeJS.ProcessEnv;
  private readonly home: string;
  private readonly temp: string;
  private readonly pathExists: (path: string) => boolean;
  private readonly startHidden: NonNullable<TaskAgentLauncherOptions["startHidden"]>;
  private readonly openExternal: NonNullable<TaskAgentLauncherOptions["openExternal"]>;
  private readonly openMacApplication: TaskAgentLauncherOptions["openMacApplication"];
  private readonly findCodexAppExecutable: NonNullable<TaskAgentLauncherOptions["findCodexAppExecutable"]>;
  private readonly queueCodexThread: NonNullable<TaskAgentLauncherOptions["queueCodexThread"]>;
  private readonly findProtocolApp: NonNullable<TaskAgentLauncherOptions["findProtocolApp"]>;
  private readonly readAgentOutput: typeof readAgentOutput;
  private readonly submitHermesTask: NonNullable<TaskAgentLauncherOptions["submitHermesTask"]>;
  private readonly path: typeof posix;

  constructor(options: TaskAgentLauncherOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.env = options.env ?? process.env;
    this.home = options.homeDirectory ?? homedir();
    // Windows TEMP is often a short 8.3 path (SAUDAM~1), which Claude Code refuses to read.
    this.temp = options.tempDirectory ?? realpathSync.native(tmpdir());
    this.pathExists = options.pathExists ?? existsSync;
    const startProcess = options.startProcess ?? startDetached;
    this.startHidden = options.startHidden ?? startHiddenProcess;
    this.openExternal =
      options.openExternal ??
      ((url) =>
        this.platform === "win32"
          ? startProcess("rundll32.exe", ["url.dll,FileProtocolHandler", url], { env: this.env })
          : startProcess("/usr/bin/open", [url], { env: this.env }));
    this.openMacApplication = options.openMacApplication;
    this.findProtocolApp = options.findProtocolApp ?? (async () => undefined);
    this.findCodexAppExecutable = options.findCodexAppExecutable ?? findCodexAppExecutable;
    this.queueCodexThread = options.queueCodexThread ?? queueCodexThread;
    this.readAgentOutput = options.readAgentOutput ?? readAgentOutput;
    this.submitHermesTask = options.submitHermesTask ?? submitHermesTask;
    this.path = this.platform === "win32" ? win32 : posix;
  }

  async listAgents(): Promise<TaskAgentStatus[]> {
    return Promise.all(
      TASK_AGENTS.map(async (agent) => ({
        id: agent.id,
        label: agent.label,
        installed: this.findCommand(agent.command) !== null || (await this.desktopApp(agent.id)) !== null
      }))
    );
  }

  /** The agent Send to agent uses: the chosen one if installed, else the first installed one. */
  resolveAgent(preference: TaskAgentPreference, agents: TaskAgentStatus[]): TaskAgentId | null {
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
    if (agent === undefined) {
      throw new Error("That agent is not installed on this computer.");
    }

    const desktop = await this.desktopApp(agent.id);
    const command = this.findCommand(agent.command);
    if (desktop === null && command === null) {
      throw new Error(`${agent.label} is not installed on this computer.`);
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
    const claudeDesktop = agent.id === "claude-code" && desktop !== null;
    const brief = buildTaskBrief(request.task, request.context, claudeDesktop ? screenshotPath : undefined);
    writeFileSync(briefPath, brief, "utf8");

    const handoff = {
      folder: request.folder,
      task: request.task,
      brief,
      briefPath,
      screenshotPath,
      image: image?.payload,
      handoffDirectory
    };

    if (desktop !== null) {
      if (agent.id === "codex") {
        const executable = await this.codexDesktopExecutable(desktop);
        if (executable === null) {
          throw new Error("Codex Desktop is installed, but Mauz could not find its app-server executable.");
        }
        await this.startInCodexApp(executable, handoff, desktop);
        return;
      }
      if (agent.id === "claude-code") {
        await this.openClaudeComposer(desktop, handoff);
        return;
      }
      if (command === null) {
        throw new Error(
          "Hermes Desktop is installed. Mauz needs the Hermes CLI to connect to its local gateway."
        );
      }
      await this.startHermes(command, handoff, desktop);
      return;
    }

    if (command === null) {
      throw new Error(`${agent.label} is not installed on this computer.`);
    }

    switch (agent.id) {
      case "codex":
        await this.startCli(
          command,
          handoff,
          [
            "exec",
            "--approve-for-me",
            "--skip-git-repo-check",
            "--cd",
            handoff.folder,
            ...(handoff.screenshotPath === undefined ? [] : ["--image", handoff.screenshotPath]),
            "-"
          ],
          handoff.briefPath
        );
        return;
      case "claude-code":
        await this.startClaudeCli(command, handoff);
        return;
      case "hermes":
        await this.startHermes(command, handoff, null);
    }
  }

  private findCommand(name: string): ResolvedCliCommand | null {
    return resolveCliCommand(name, {
      platform: this.platform,
      env: this.env,
      homeDirectory: this.home,
      pathExists: this.pathExists,
      fallbackNodeRuntime: process.versions.electron === undefined ? undefined : process.execPath
    });
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
    mkdirSync(directory, { mode: 0o700 });

    return directory;
  }

  private async desktopApp(agentId: TaskAgentId): Promise<string | null> {
    const { names, scheme } = DESKTOP_APPS[agentId];
    if (this.platform !== "darwin" && this.platform !== "win32") return null;

    const handler = await this.findProtocolApp(scheme);
    const extension = this.platform === "darwin" ? ".app" : ".exe";
    const needsMacCodexExecutable = this.platform === "darwin" && agentId === "codex";
    let installedApp: string | null = null;
    if (
      handler !== undefined &&
      names.some((name) => this.path.basename(handler).toLowerCase() === `${name}${extension}`.toLowerCase())
    ) {
      if (!needsMacCodexExecutable || this.macCodexExecutable(handler) !== null) return handler;
      installedApp = handler;
    }

    if (this.platform === "darwin") {
      for (const root of ["/Applications", this.path.join(this.home, "Applications")]) {
        for (const name of names) {
          const bundle = this.path.join(root, `${name}.app`);
          if (!this.pathExists(bundle)) continue;
          if (!needsMacCodexExecutable || this.macCodexExecutable(bundle) !== null) return bundle;
          installedApp ??= bundle;
        }
      }
      if (agentId === "hermes") {
        const hermesHome = this.env.HERMES_HOME ?? this.path.join(this.home, ".hermes");
        const bundle = this.path.join(
          hermesHome,
          "hermes-agent",
          "apps",
          "desktop",
          "release",
          "mac-arm64",
          "Hermes.app"
        );
        if (this.pathExists(bundle)) return bundle;
      }
      // Preserve the desktop launch error if Codex is installed without a bundled executable.
      return installedApp;
    }

    const { LOCALAPPDATA: local, APPDATA: roaming } = this.env;
    const candidates: string[] = [];
    if (agentId === "hermes") {
      if (roaming !== undefined) {
        candidates.push(
          this.path.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "Hermes.lnk")
        );
      }
      if (local !== undefined) {
        candidates.push(
          this.path.join(
            local,
            "hermes",
            "hermes-agent",
            "apps",
            "desktop",
            "release",
            "win-unpacked",
            "Hermes.exe"
          )
        );
      }
    } else if (local !== undefined) {
      const packageFamily = agentId === "codex" ? CODEX_PACKAGE_FAMILY : CLAUDE_PACKAGE_FAMILY;
      candidates.push(this.path.join(local, "Microsoft", "WindowsApps", packageFamily));
    }

    return candidates.find(this.pathExists) ?? null;
  }

  private async codexDesktopExecutable(desktop: string): Promise<string | null> {
    if (this.platform === "win32") {
      const bundled = this.path.join(this.path.dirname(desktop), "resources", "codex.exe");
      return this.path.extname(desktop) === ".exe" && this.pathExists(bundled)
        ? bundled
        : this.findCodexAppExecutable();
    }

    return this.macCodexExecutable(desktop);
  }

  private macCodexExecutable(desktop: string): string | null {
    const resources = this.path.join(desktop, "Contents", "Resources");
    return (
      [
        this.path.join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
        this.path.join(resources, "codex")
      ].find(this.pathExists) ?? null
    );
  }

  private async startHermes(
    command: ResolvedCliCommand,
    handoff: DesktopHandoff,
    desktop: string | null
  ): Promise<void> {
    const env = { ...buildAgentEnvironment(this.env), ...command.env };
    const options = { env, cwd: handoff.folder };
    if (desktop === null) {
      const approvals = await this.readAgentOutput(
        command.command,
        [...command.args, "config", "get", "approvals", "--json"],
        options
      )
        .then((output) => JSON.parse(output) as { mode?: unknown; single_query_mode?: unknown } | null)
        .catch(() => null);
      if (approvals?.mode !== "smart" || approvals.single_query_mode !== "deny") {
        throw new Error(
          "Hermes needs Smart approvals and single-query approval mode Deny for background tasks from Mauz."
        );
      }
    }

    if (desktop !== null || handoff.screenshotPath !== undefined) {
      const sessionId = await this.submitHermesTask({
        attach: () =>
          this.readAgentOutput(
            command.command,
            [...command.args, "gateway", "attach", "--start", "--json"],
            options
          ),
        cwd: handoff.folder,
        text: handoff.brief,
        imagePath: handoff.screenshotPath,
        desktop: desktop !== null
      });
      if (desktop !== null) {
        try {
          await this.openDesktopLink(desktop, `hermes://open/${encodeURIComponent(sessionId)}`);
        } catch {
          throw new Error("Hermes accepted the task. Open the new Hermes Desktop session to continue.");
        }
      } else {
        writeFileSync(
          this.path.join(handoff.handoffDirectory, "agent.log"),
          `Hermes session: ${sessionId}\n`,
          { mode: 0o600 }
        );
      }
      return;
    }

    await this.startCli(command, handoff, [
      "chat",
      "-Q",
      "--query-file",
      handoff.briefPath,
      "--in",
      handoff.folder
    ]);
  }

  private async openClaudeComposer(desktop: string, handoff: DesktopHandoff): Promise<void> {
    const url = new URL("claude://code/new");
    const briefInstruction = `Read the full Mauz task brief and captured context at ${JSON.stringify(handoff.briefPath)} before starting.`;
    url.searchParams.set("folder", handoff.folder);
    url.searchParams.set("q", `${handoff.task.trim()}\n\n${briefInstruction}`);
    // Keep OS protocol activation short. The full text is available in the brief.
    if (url.href.length > MAX_CLAUDE_DESKTOP_URL_LENGTH) {
      url.searchParams.set("q", `${threadTitle(handoff.task)}\n\n${briefInstruction}`);
    }

    try {
      await this.openDesktopLink(desktop, url.href);
    } catch (cause) {
      throw new Error("Mauz could not open the Code composer. Check Claude Desktop and try again.", {
        cause
      });
    }
  }

  private async startClaudeCli(command: ResolvedCliCommand, handoff: DesktopHandoff): Promise<void> {
    const promptPath = this.path.join(handoff.handoffDirectory, "prompt.jsonl");
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
    writeFileSync(
      promptPath,
      `${JSON.stringify(message)}
`,
      { encoding: "utf8", mode: 0o600 }
    );
    await this.startCli(
      command,
      handoff,
      [
        "-p",
        "--permission-mode",
        "auto",
        "--permission-prompts",
        "none",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose"
      ],
      promptPath
    );
  }

  private async startCli(
    command: ResolvedCliCommand,
    handoff: DesktopHandoff,
    args: string[],
    stdinPath?: string
  ): Promise<void> {
    await this.startHidden(command.command, [...command.args, ...args], {
      env: { ...buildAgentEnvironment(this.env), ...command.env },
      cwd: handoff.folder,
      logPath: this.path.join(handoff.handoffDirectory, "agent.log"),
      ...(stdinPath === undefined ? {} : { stdinPath })
    });
  }

  private async startInCodexApp(
    codexExecutable: string,
    handoff: DesktopHandoff,
    desktop: string
  ): Promise<void> {
    const threadId = await this.queueCodexThread(codexExecutable, {
      folder: handoff.folder,
      title: threadTitle(handoff.task),
      text: handoff.brief,
      imagePath: handoff.screenshotPath,
      env: buildAgentEnvironment(this.env)
    });

    try {
      await this.openDesktopLink(desktop, `codex://threads/wake/${threadId}`);
      await this.openDesktopLink(desktop, `codex://threads/${threadId}`);
    } catch {
      throw new Error("The task was queued in Codex. Open the new thread in Codex to continue.");
    }
  }

  private async openDesktopLink(desktop: string, url: string): Promise<void> {
    if (this.platform === "darwin" && this.openMacApplication !== undefined) {
      await this.openMacApplication(desktop, url);
      return;
    }
    await this.openExternal(url);
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
