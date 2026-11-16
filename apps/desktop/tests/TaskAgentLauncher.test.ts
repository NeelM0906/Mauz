import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MauzDesktopContext, TaskAgentId } from "@mauzai/shared";
import { buildAgentEnvironment } from "../src/main/agent/agentProcess";
import { TaskAgentLauncher, threadTitle } from "../src/main/agent/TaskAgentLauncher";

const CONTEXT: MauzDesktopContext = {
  timestamp: "2026-11-04T12:00:00.000Z",
  platform: "win32",
  cursor: { x: 10, y: 20 },
  selectedText: "TypeError: x is undefined",
  pointer: {
    cursor: { x: 10, y: 20 },
    cursorCrop: {
      mimeType: "image/png",
      base64: Buffer.from("png-bytes").toString("base64"),
      width: 4,
      height: 3
    },
    cursorCropFocus: { kind: "element", pointer: { x: 2, y: 1 } },
    target: {
      source: "windows-uia",
      element: { role: "Text", name: "TypeError: x is undefined" },
      window: { title: "app.ts - Mauz - Visual Studio Code", appName: "Visual Studio Code" }
    }
  }
};

function createHome(): string {
  return mkdtempSync(join(tmpdir(), "mauz-launcher-test-"));
}

describe("TaskAgentLauncher", () => {
  it.each([
    ["claude-code", "claude", "--permission-mode"],
    ["codex", "codex", "--approve-for-me"],
    ["hermes", "hermes", "--query-file"]
  ] as const)("uses a windowless %s CLI when its desktop app is absent", async (agentId, command, flag) => {
    const home = createHome();
    const folder = join(home, "work folder");
    mkdirSync(folder);
    const startHidden = vi.fn(async () => {});
    const startProcess = vi.fn(async () => {});
    const executable = `/mauz-test-bin/${command}`;
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/mauz-test-bin", MAUZ_LOCAL_TOKEN: "test" },
      readAgentOutput: async () => JSON.stringify({ mode: "smart", single_query_mode: "deny" }),
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => path === executable || path === folder,
      startHidden,
      startProcess
    });

    const context = agentId === "hermes" ? { ...CONTEXT, pointer: undefined } : CONTEXT;
    await launcher.launch({ agentId, folder, task: "Inspect this error", context });

    expect(startProcess).not.toHaveBeenCalled();
    expect(startHidden).toHaveBeenCalledWith(
      executable,
      expect.arrayContaining([flag]),
      expect.objectContaining({ cwd: folder, logPath: expect.stringMatching(/agent\.log$/) })
    );
  });

  it("wakes a new Codex desktop thread on macOS without a standalone CLI", async () => {
    const home = createHome();
    const appPath = "/Applications/ChatGPT.app";
    const executable = `${appPath}/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`;
    const queueCodexThread = vi.fn(async () => "00000000-0000-4000-8000-000000000001");
    const openExternal = vi.fn(async () => {});
    const startHidden = vi.fn(async () => {});
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: {},
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => [home, appPath, executable].includes(path),
      queueCodexThread,
      openExternal,
      startHidden
    });

    expect((await launcher.listAgents()).find(({ id }) => id === "codex")?.installed).toBe(true);
    await launcher.launch({ agentId: "codex", folder: home, task: "Inspect this error", context: CONTEXT });

    expect(queueCodexThread).toHaveBeenCalledWith(
      executable,
      expect.objectContaining({ folder: home, text: expect.stringContaining("Inspect this error") })
    );
    expect(openExternal).toHaveBeenNthCalledWith(
      1,
      "codex://threads/wake/00000000-0000-4000-8000-000000000001"
    );
    expect(openExternal).toHaveBeenNthCalledWith(2, "codex://threads/00000000-0000-4000-8000-000000000001");
    expect(startHidden).not.toHaveBeenCalled();
  });

  it.each([
    { handlerDescription: "no registered handler", handler: undefined },
    { handlerDescription: "ChatGPT registered as the handler", handler: "/Applications/ChatGPT.app" }
  ])("uses the working Codex bundle with $handlerDescription", async ({ handler }) => {
    const home = createHome();
    const desktop = "/Applications/Codex.app";
    const executable = `${desktop}/Contents/Resources/codex`;
    const threadId = "00000000-0000-4000-8000-000000000001";
    const queueCodexThread = vi.fn(async () => threadId);
    const openMacApplication = vi.fn(async () => {});
    const startHidden = vi.fn(async () => {});
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/test" },
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) =>
        [home, "/Applications/ChatGPT.app", desktop, executable, "/test/codex"].includes(path),
      findProtocolApp: async () => handler,
      queueCodexThread,
      openMacApplication,
      startHidden
    });

    await launcher.launch({ agentId: "codex", folder: home, task: "Inspect this error", context: CONTEXT });

    expect(queueCodexThread).toHaveBeenCalledWith(executable, expect.objectContaining({ folder: home }));
    expect(openMacApplication).toHaveBeenNthCalledWith(1, desktop, `codex://threads/wake/${threadId}`);
    expect(openMacApplication).toHaveBeenNthCalledWith(2, desktop, `codex://threads/${threadId}`);
    expect(startHidden).not.toHaveBeenCalled();
  });

  it.each(["hermes", "codex"] as const)(
    "treats a desktop-only %s install as available and does not fall back after a desktop error",
    async (agentId) => {
      const home = createHome();
      const desktopPaths: Record<Exclude<TaskAgentId, "claude-code">, string> = {
        hermes: "/Applications/Hermes.app",
        codex: "/Applications/ChatGPT.app"
      };
      const startHidden = vi.fn(async () => {});
      const startProcess = vi.fn(async () => {});
      const launcher = new TaskAgentLauncher({
        platform: "darwin",
        env: { PATH: "/mauz-test-no-cli" },
        homeDirectory: home,
        tempDirectory: home,
        pathExists: (path) => path === desktopPaths[agentId] || path === home,
        startHidden,
        startProcess
      });

      expect((await launcher.listAgents()).find(({ id }) => id === agentId)?.installed).toBe(true);
      await expect(
        launcher.launch({ agentId, folder: home, task: "Inspect this error", context: CONTEXT })
      ).rejects.toThrow(/desktop/i);
      expect(startHidden).not.toHaveBeenCalled();
      expect(startProcess).not.toHaveBeenCalled();
    }
  );

  it("finds agents on PATH and picks the configured or first installed one", async () => {
    const existing = new Set(["C:\\bin\\claude.exe", "C:\\bin\\codex.exe"]);
    const launcher = new TaskAgentLauncher({
      platform: "win32",
      env: { PATH: "C:\\bin" },
      homeDirectory: "C:\\Users\\me",
      pathExists: (path) => existing.has(path)
    });

    const agents = await launcher.listAgents();
    expect(agents).toEqual([
      { id: "hermes", label: "Hermes", installed: false },
      { id: "claude-code", label: "Claude Code", installed: true },
      { id: "codex", label: "Codex", installed: true }
    ]);
    expect(launcher.resolveAgent("codex", agents)).toBe("codex");
    expect(launcher.resolveAgent("hermes", agents)).toBe("claude-code");
    expect(launcher.resolveAgent("auto", agents)).toBe("claude-code");
  });

  it("lists Claude Code folders by last use and skips worktrees and missing folders", () => {
    const home = createHome();
    const projectA = join(home, "projects", "alpha");
    const projectB = join(home, "projects", "beta");
    mkdirSync(projectA, { recursive: true });
    mkdirSync(projectB, { recursive: true });
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({
        projects: {
          [projectA]: {},
          [projectB]: {},
          [join(home, "gone")]: {},
          [join(projectA, ".claude", "worktrees", "feature")]: {}
        }
      })
    );
    const sessions = (path: string): string =>
      join(home, ".claude", "projects", path.replace(/[^a-zA-Z0-9]/g, "-"));
    mkdirSync(sessions(projectA), { recursive: true });
    mkdirSync(sessions(projectB), { recursive: true });
    utimesSync(sessions(projectA), new Date("2026-01-01"), new Date("2026-01-01"));
    utimesSync(sessions(projectB), new Date("2026-06-01"), new Date("2026-06-01"));

    const launcher = new TaskAgentLauncher({ homeDirectory: home, env: {} });

    expect(launcher.listFolders("claude-code").map((folder) => folder.name)).toEqual(["beta", "alpha"]);
  });

  it("lists Codex folders from the first line of each session transcript", () => {
    const home = createHome();
    const project = join(home, "code", "gamma");
    mkdirSync(project, { recursive: true });
    const day = join(home, ".codex", "sessions", "2026", "11", "04");
    mkdirSync(day, { recursive: true });
    writeFileSync(
      join(day, "rollout-1.jsonl"),
      `${JSON.stringify({ type: "session_meta", payload: { cwd: project } })}\n{"type":"other"}\n`
    );
    writeFileSync(join(day, "rollout-2.jsonl"), "not json\n");

    const launcher = new TaskAgentLauncher({ homeDirectory: home, env: {} });

    expect(launcher.listFolders("codex")).toEqual([{ path: project, name: "gamma" }]);
  });

  it("returns no Hermes folders when Hermes has no projects database", () => {
    const launcher = new TaskAgentLauncher({ homeDirectory: createHome(), env: {} });

    expect(launcher.listFolders("hermes")).toEqual([]);
  });

  it.runIf(process.platform === "win32")("passes a Windows folder and brief to a hidden CLI", async () => {
    const home = createHome();
    const folder = join(home, "work & tests");
    mkdirSync(folder);
    const executable = join(home, "bin", "codex.exe");
    const startHidden = vi.fn(async () => {});
    const startProcess = vi.fn(async () => {});
    const launcher = new TaskAgentLauncher({
      platform: "win32",
      env: { PATH: join(home, "bin"), MAUZ_LOCAL_TOKEN: "secret", ELECTRON_RUN_AS_NODE: "1" },
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => path === executable || path === folder,
      startHidden,
      startProcess
    });

    await launcher.launch({ agentId: "codex", folder, task: "Fix this error", context: CONTEXT });

    expect(startProcess).not.toHaveBeenCalled();
    const [, args, options] = startHidden.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; stdinPath: string; cwd: string }
    ];
    expect(args).toContain(folder);
    expect(options.cwd).toBe(folder);
    expect(options.env).not.toHaveProperty("MAUZ_LOCAL_TOKEN");
    expect(options.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    const brief = readFileSync(options.stdinPath, "utf8");
    expect(brief).toContain("<task>\nFix this error\n</task>");
    expect(brief).toContain("<selected_text>\nTypeError: x is undefined\n</selected_text>");
    expect(readFileSync(args[args.indexOf("--image") + 1]!, "utf8")).toBe("png-bytes");
  });

  it("starts Claude Code with Auto and sends the brief and image as one message", async () => {
    const home = createHome();
    mkdirSync(join(home, ".claude"));
    writeFileSync(
      join(home, ".claude", "settings.json"),
      JSON.stringify({
        permissions: { defaultMode: "bypassPermissions" }
      })
    );
    const startHidden = vi.fn(async () => {});
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/test", CLAUDE_CODE_SESSION_ID: "parent", CLAUDECODE: "1" },
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => path === "/test/claude" || path === home,
      startHidden
    });

    await launcher.launch({ agentId: "claude-code", folder: home, task: "Fix this error", context: CONTEXT });

    const [command, args, options] = startHidden.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; stdinPath: string }
    ];
    expect(command).toBe("/test/claude");
    expect(args).toEqual([
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
    ]);
    expect(options.env).not.toHaveProperty("CLAUDECODE");
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_SESSION_ID");
    const payload = JSON.parse(readFileSync(options.stdinPath, "utf8")) as {
      message: { content: unknown[] };
    };
    expect(payload.message.content).toEqual([
      { type: "text", text: expect.stringContaining("Fix this error") },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: Buffer.from("png-bytes").toString("base64") }
      }
    ]);
  });

  it.each([true, false])("prefills Claude Desktop with the CLI installed: %s", async (hasCli) => {
    const home = createHome();
    const folder = join(home, "Work & notes #1");
    const startHidden = vi.fn(async () => {});
    const openMacApplication = vi.fn(async (_bundle: string, _url: string) => {});
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/test" },
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => path === folder || (hasCli && path === "/test/claude"),
      findProtocolApp: async () => "/opt/Claude.app",
      startHidden,
      openMacApplication
    });

    expect((await launcher.listAgents()).find(({ id }) => id === "claude-code")?.installed).toBe(true);
    const task = "Fix café error? Check a+b & c";
    await launcher.launch({ agentId: "claude-code", folder, task, context: CONTEXT });

    expect(openMacApplication).toHaveBeenCalledOnce();
    const [bundle, link] = openMacApplication.mock.calls[0]!;
    const url = new URL(link);
    expect(bundle).toBe("/opt/Claude.app");
    expect(url.protocol + "//" + url.host + url.pathname).toBe("claude://code/new");
    expect(url.searchParams.get("folder")).toBe(folder);
    expect(url.searchParams.get("q")).toContain(task);
    expect(url.searchParams.get("file")).toBeNull();
    const briefPath = JSON.parse(url.searchParams.get("q")!.match(/"[^\n]+task\.md"/)![0]) as string;
    const brief = readFileSync(briefPath, "utf8");
    expect(brief).toContain(task);
    expect(brief).toContain("TypeError: x is undefined");
    const screenshotPath = posix.join(briefPath, "..", "screen.png");
    expect(brief).toContain("saved at");
    expect(brief).toContain(JSON.stringify(screenshotPath));
    expect(readFileSync(screenshotPath, "utf8")).toBe("png-bytes");
    expect(startHidden).not.toHaveBeenCalled();
  });

  it("preserves long Claude Desktop tasks in the local brief when keeping the URI short", async () => {
    const home = createHome();
    const openExternal = vi.fn(async (_url: string) => {});
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: {},
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) => path === "/Applications/Claude.app" || path === home,
      openExternal
    });
    const task = `Inspect the report\n${"漢".repeat(3500)}`;

    await launcher.launch({
      agentId: "claude-code",
      folder: home,
      task,
      context: { ...CONTEXT, pointer: undefined }
    });

    const [link] = openExternal.mock.calls[0]!;
    expect(link.length).toBeLessThan(8_000);
    const prompt = new URL(link).searchParams.get("q")!;
    expect(prompt).toContain("Inspect the report");
    const briefPath = JSON.parse(prompt.match(/"[^\n]+task\.md"/)![0]) as string;
    expect(readFileSync(briefPath, "utf8")).toContain(task);
  });

  it("does not rerun a Codex task in the CLI when Desktop cannot be opened", async () => {
    const home = createHome();
    const desktop = "/Applications/Codex.app";
    const startHidden = vi.fn(async () => {});
    const queueCodexThread = vi.fn(async () => "00000000-0000-4000-8000-000000000001");
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/test" },
      homeDirectory: home,
      tempDirectory: home,
      pathExists: (path) =>
        ["/test/codex", home, desktop, `${desktop}/Contents/Resources/codex`].includes(path),
      queueCodexThread,
      startHidden,
      openExternal: async () => {
        throw new Error("Could not open app");
      }
    });

    await expect(
      launcher.launch({ agentId: "codex", folder: home, task: "Fix this error", context: CONTEXT })
    ).rejects.toThrow("task was queued in Codex");
    expect(queueCodexThread).toHaveBeenCalledOnce();
    expect(startHidden).not.toHaveBeenCalled();
  });

  it("opens Hermes Desktop on the newly accepted live session", async () => {
    const home = createHome();
    const exe = "/test/hermes";
    const openExternal = vi.fn(async () => {});
    const startHidden = vi.fn(async () => {});
    const readAgentOutput = vi.fn(async () => "gateway-bootstrap");
    const submitHermesTask = vi.fn(async (request: { attach: () => Promise<string> }) => {
      expect(await request.attach()).toBe("gateway-bootstrap");
      return "new-session";
    });
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/test", MAUZ_LOCAL_TOKEN: "secret", HERMES_YOLO_MODE: "1" },
      pathExists: (path) => path === exe || path === home,
      homeDirectory: home,
      tempDirectory: home,
      findProtocolApp: async (scheme) => (scheme === "hermes" ? "/opt/Hermes.app" : undefined),
      readAgentOutput,
      submitHermesTask,
      startHidden,
      openExternal
    });

    await launcher.launch({ agentId: "hermes", folder: home, task: "Fix this error", context: CONTEXT });

    expect(submitHermesTask).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: home,
        desktop: true,
        text: expect.stringContaining("Fix this error"),
        imagePath: expect.stringMatching(/screen\.png$/)
      })
    );
    expect(readAgentOutput).toHaveBeenCalledExactlyOnceWith(exe, ["gateway", "attach", "--start", "--json"], {
      cwd: home,
      env: { PATH: "/test" }
    });
    expect(openExternal).toHaveBeenCalledExactlyOnceWith("hermes://open/new-session");
    expect(startHidden).not.toHaveBeenCalled();
  });

  it.runIf(process.platform === "win32")(
    "queues the task on a new Codex thread and wakes the Codex desktop app",
    async () => {
      const home = createHome();
      const folder = join(home, "work");
      mkdirSync(folder);
      const localAppData = join(home, "local");
      mkdirSync(join(localAppData, "Microsoft", "WindowsApps", "OpenAI.Codex_2p2nqsd0c76g0"), {
        recursive: true
      });
      const queueCodexThread = vi.fn(async () => "thread-1");
      const openExternal = vi.fn(async () => {});
      const launcher = new TaskAgentLauncher({
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: localAppData },
        homeDirectory: home,
        tempDirectory: createHome(),
        pathExists: existsSync,
        findCodexAppExecutable: async () => "C:\\Codex\\codex.exe",
        queueCodexThread,
        openExternal
      });

      // The Codex app alone counts as installed: it brings its own codex.exe.
      expect((await launcher.listAgents()).find((agent) => agent.id === "codex")?.installed).toBe(true);
      await expect(
        launcher.launch({ agentId: "codex", folder, task: "Fix this error\nin the parser", context: CONTEXT })
      ).resolves.toBeUndefined();

      const [executable, request] = queueCodexThread.mock.calls[0] as unknown as [
        string,
        { folder: string; title: string; text: string; imagePath: string }
      ];

      expect(executable).toBe("C:\\Codex\\codex.exe");
      expect(request.folder).toBe(folder);
      expect(request.title).toBe("Fix this error");
      expect(request.text).toContain("<task>\nFix this error\nin the parser\n</task>");
      expect(request.imagePath.endsWith("screen.png")).toBe(true);
      expect(openExternal).toHaveBeenCalledWith("codex://threads/wake/thread-1");
    }
  );

  it("builds short thread titles", () => {
    expect(threadTitle("  \n")).toBe("Task from Mauz");
    expect(threadTitle("a".repeat(80))).toBe(`${"a".repeat(59)}…`);
  });

  it("refuses an agent that is not installed or a folder that is gone", async () => {
    const launcher = new TaskAgentLauncher({
      env: { PATH: "" },
      homeDirectory: createHome(),
      pathExists: () => false
    });

    await expect(
      launcher.launch({ agentId: "codex", folder: "/nowhere", task: "x", context: CONTEXT })
    ).rejects.toThrow("Codex is not installed");
  });
});

describe("agent handoffs", () => {
  it("keeps the user's environment but drops Mauz, provider key, and Electron variables", () => {
    expect(
      buildAgentEnvironment({
        PATH: "p",
        OPENAI_BASE_URL: "u",
        MAUZ_X: "1",
        ELECTRON_RUN_AS_NODE: "1",
        OPENAI_API_KEY: "sk-mauz",
        ANTHROPIC_API_KEY: "sk-ant-mauz",
        OPENAI_ASK_MODEL: "m"
      })
    ).toEqual({ PATH: "p", OPENAI_BASE_URL: "u" });
  });

  it("deletes hand-off folders older than a day, without waiting for another send", () => {
    const temp = createHome();
    const root = join(temp, "mauz-handoff");
    const old = join(root, "old");
    const recent = join(root, "recent");
    mkdirSync(old, { recursive: true });
    mkdirSync(recent, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(old, twoDaysAgo, twoDaysAgo);

    const stop = new TaskAgentLauncher({ tempDirectory: temp }).startHandoffCleanup();
    stop();

    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
  });
});

// Defects from docs/reafactor-audit.md, fixed by refactor row 3.
describe("known defects", () => {
  it("finds Claude Code at MAUZ_CLAUDE_CODE_PATH, as Ask does", async () => {
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/usr/bin", MAUZ_CLAUDE_CODE_PATH: "/opt/tools/claude" },
      homeDirectory: "/Users/me",
      pathExists: (path) => path === "/opt/tools/claude"
    });

    expect((await launcher.listAgents()).find((agent) => agent.id === "claude-code")?.installed).toBe(true);
  });

  it("finds Codex at MAUZ_CODEX_PATH, as Ask does", async () => {
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/usr/bin", MAUZ_CODEX_PATH: "/opt/tools/codex" },
      homeDirectory: "/Users/me",
      pathExists: (path) => path === "/opt/tools/codex"
    });

    expect((await launcher.listAgents()).find((agent) => agent.id === "codex")?.installed).toBe(true);
  });

  it("finds Claude Code in ~/.claude/local, as Ask does", async () => {
    const launcher = new TaskAgentLauncher({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      homeDirectory: "/Users/me",
      pathExists: (path) => path === "/Users/me/.claude/local/claude"
    });

    expect((await launcher.listAgents()).find((agent) => agent.id === "claude-code")?.installed).toBe(true);
  });

  it("drops ANTHROPIC_AUTH_TOKEN, as the Ask CLI providers do", () => {
    expect(buildAgentEnvironment({ PATH: "p", ANTHROPIC_AUTH_TOKEN: "token" })).toEqual({ PATH: "p" });
  });
});
