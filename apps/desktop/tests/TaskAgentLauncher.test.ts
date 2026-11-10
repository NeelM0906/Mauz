import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import {
  buildAgentArguments,
  buildAgentEnvironment,
  buildHiddenStartCommand,
  buildPowerShellLauncher,
  buildShellLauncher,
  TaskAgentLauncher,
  threadTitle
} from "../src/main/agent/TaskAgentLauncher";

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
  it("finds agents on PATH and npm shims, and picks the configured or first installed one", () => {
    const existing = new Set(["C:\\bin\\claude.exe", "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd"]);
    const launcher = new TaskAgentLauncher({
      platform: "win32",
      env: { PATH: "C:\\bin", APPDATA: "C:\\Users\\me\\AppData\\Roaming" },
      homeDirectory: "C:\\Users\\me",
      pathExists: (path) => existing.has(path)
    });

    const agents = launcher.listAgents();

    expect(agents).toEqual([
      { id: "hermes", label: "Hermes", installed: false },
      { id: "claude-code", label: "Claude Code", installed: true },
      { id: "codex", label: "Codex", installed: true }
    ]);
    expect(launcher.resolveAgent("codex", agents)).toBe("codex");
    expect(launcher.resolveAgent("hermes", agents)).toBe("claude-code");
    expect(launcher.resolveAgent("auto", agents)).toBe("claude-code");
    expect(launcher.findExecutable("codex")).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd");
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

  // Uses real Windows paths on disk; the Windows CI job runs it.
  it.runIf(process.platform === "win32")(
    "writes the brief and screenshot, then opens the agent in a terminal",
    async () => {
      const home = createHome();
      const temp = createHome();
      const folder = join(home, "work");
      mkdirSync(folder);
      const startProcess = vi.fn(async () => {});
      const launcher = new TaskAgentLauncher({
        platform: "win32",
        env: {
          PATH: "",
          LOCALAPPDATA: join(home, "local"),
          ELECTRON_RUN_AS_NODE: "1",
          MAUZ_LOCAL_TOKEN: "x"
        },
        homeDirectory: home,
        tempDirectory: temp,
        pathExists: (path) => path.endsWith("hermes.exe") || path === folder,
        startProcess
      });

      await expect(
        launcher.launch({ agentId: "hermes", folder, task: "Fix this error", context: CONTEXT })
      ).resolves.toEqual({ agentLabel: "Hermes" });

      expect(startProcess).toHaveBeenCalledOnce();
      const [command, args, options] = startProcess.mock.calls[0] as unknown as [
        string,
        string[],
        { env: NodeJS.ProcessEnv }
      ];
      expect(command).toBe("cmd.exe");
      expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
      expect(options.env.MAUZ_LOCAL_TOKEN).toBeUndefined();

      const scriptPath = /-File "([^"]+)"/.exec(args[0] ?? "")?.[1] ?? "";
      const handoff = join(scriptPath, "..");
      const brief = readFileSync(join(handoff, "task.md"), "utf8");
      const script = readFileSync(scriptPath, "utf8");

      // Windows PowerShell 5.1 needs the BOM to read the "→" in the title as UTF-8.
      expect([...readFileSync(scriptPath).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(script).toContain("$Host.UI.RawUI.WindowTitle = 'Mauz → Hermes'");
      expect(brief).toContain("<task>\nFix this error\n</task>");
      expect(brief).toContain("<selected_text>\nTypeError: x is undefined\n</selected_text>");
      expect(brief).toContain("<image>attached: crop framed on the pointed element");
      expect(readFileSync(join(handoff, "screen.png"), "utf8")).toBe("png-bytes");
      expect(script).toContain(`Set-Location -LiteralPath '${folder}'`);
      expect(script).toContain("'chat' '--query-file'");
      expect(script).toContain("'--image'");
    }
  );

  // The desktop-app routes are Windows-only and use real Windows paths.
  it.runIf(process.platform === "win32")(
    "starts Hermes as a hidden one-shot when the Hermes desktop app is installed",
    async () => {
      const home = createHome();
      const folder = join(home, "work");
      mkdirSync(folder);
      const appData = join(home, "roaming");
      const startHidden = vi.fn(async () => {});
      const startProcess = vi.fn(async () => {});
      const launcher = new TaskAgentLauncher({
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: join(home, "local"), APPDATA: appData, MAUZ_LOCAL_TOKEN: "x" },
        homeDirectory: home,
        tempDirectory: createHome(),
        pathExists: (path) =>
          path === join(home, "local", "hermes", "bin", "hermes.exe") ||
          path === folder ||
          path === join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Hermes.lnk"),
        startProcess,
        startHidden
      });

      await expect(
        launcher.launch({ agentId: "hermes", folder, task: "Fix this error", context: CONTEXT })
      ).resolves.toEqual({ agentLabel: "Hermes" });

      expect(startProcess).not.toHaveBeenCalled();
      const [executable, args, options] = startHidden.mock.calls[0] as unknown as [
        string,
        string[],
        { cwd: string; logPath: string; env: NodeJS.ProcessEnv }
      ];
      const handoff = join(options.logPath, "..");

      expect(executable).toBe(join(home, "local", "hermes", "bin", "hermes.exe"));
      expect(args).toEqual([
        "chat",
        "-Q",
        "--source",
        "cli",
        "--query-file",
        join(handoff, "task.md"),
        "--image",
        join(handoff, "screen.png"),
        "--in",
        folder
      ]);
      expect(options.cwd).toBe(folder);
      expect(options.env.MAUZ_LOCAL_TOKEN).toBeUndefined();
    }
  );

  it.runIf(process.platform === "win32")(
    "runs Claude Code headless and hands the session to Claude desktop without showing it",
    async () => {
      const home = createHome();
      const folder = join(home, "work");
      mkdirSync(folder);
      const localAppData = join(home, "local");
      mkdirSync(join(localAppData, "Microsoft", "WindowsApps", "Claude_pzs8sxrjxfjjc"), { recursive: true });
      const startHidden = vi.fn(async () => {});
      const startProcess = vi.fn(async () => {});
      // The run's log as Mauz polls it: still working, then the result.
      const logLines = ['{"type":"assistant"}\n', '{"type":"result","subtype":"success"}\n'];
      const launcher = new TaskAgentLauncher({
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: localAppData, CLAUDE_CODE_SESSION_ID: "parent", CLAUDECODE: "1" },
        homeDirectory: home,
        tempDirectory: createHome(),
        pathExists: (path) => path === join(home, ".local", "bin", "claude.exe") || existsSync(path),
        startProcess,
        startHidden,
        sleep: async () => {
          const [, , options] = startHidden.mock.calls[0] as unknown as [
            string,
            string[],
            { logPath: string }
          ];
          writeFileSync(options.logPath, logLines.shift() ?? "", { flag: "a" });
          // Not imported while the run is still going.
          expect(startProcess).toHaveBeenCalledTimes(0);
        }
      });

      await expect(
        launcher.launch({ agentId: "claude-code", folder, task: "Fix this error", context: CONTEXT })
      ).resolves.toEqual({ agentLabel: "Claude Code" });
      await launcher.settled();

      const [executable, args, options] = startHidden.mock.calls[0] as unknown as [
        string,
        string[],
        { cwd: string; logPath: string; stdinPath: string; env: NodeJS.ProcessEnv }
      ];
      const handoff = join(options.logPath, "..");
      const sessionId = args[args.indexOf("--session-id") + 1] ?? "";

      expect(executable).toBe(join(home, ".local", "bin", "claude.exe"));
      expect(args).toEqual([
        "-p",
        "--session-id",
        sessionId,
        "--permission-mode",
        "auto",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose"
      ]);
      expect(options.cwd).toBe(folder);
      expect(options.env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
      expect(options.env.CLAUDECODE).toBeUndefined();

      // The prompt is one message: the brief, with the screenshot attached.
      expect(options.stdinPath).toBe(join(handoff, "prompt.jsonl"));
      const message = JSON.parse(readFileSync(options.stdinPath, "utf8")) as {
        message: { content: Array<{ type: string; text?: string; source?: unknown }> };
      };
      expect(message.message.content[0]?.text).toContain(
        "<image>attached: crop framed on the pointed element"
      );
      expect(message.message.content[1]).toEqual({
        type: "image",
        source: { type: "base64", media_type: "image/png", data: Buffer.from("png-bytes").toString("base64") }
      });

      // Imported once, when the run has ended.
      expect(startProcess).toHaveBeenCalledTimes(1);
      expect(startProcess).toHaveBeenCalledWith(
        join(localAppData, "Microsoft", "WindowsApps", "claude-desktop.exe"),
        ["--startup", `claude://resume?session=${sessionId}`],
        expect.anything()
      );
    }
  );

  it.runIf(process.platform === "win32")(
    "runs Claude Code in the mode the user picked for the folder, else Claude Code's default, else auto",
    () => {
      const home = createHome();
      const localAppData = join(home, "local");
      const launcher = new TaskAgentLauncher({
        platform: "win32",
        env: { PATH: "", LOCALAPPDATA: localAppData },
        homeDirectory: home
      });

      expect(launcher.claudePermissionMode("C:\\work\\mauz")).toBe("auto");

      mkdirSync(join(home, ".claude"));
      writeFileSync(
        join(home, ".claude", "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "acceptEdits" } })
      );
      expect(launcher.claudePermissionMode("C:\\work\\mauz")).toBe("acceptEdits");

      const desktopData = join(localAppData, "Claude-Data", "claude_pzs8sxrjxfjjc");
      mkdirSync(desktopData, { recursive: true });
      writeFileSync(
        join(desktopData, "claude_desktop_config.json"),
        JSON.stringify({
          preferences: {
            epitaxyPrefs: {
              "epitaxy-folder-permission-mode-v2.account-1": { "C:\\Work\\Mauz": "bypassPermissions" },
              "epitaxy-folder-permission-mode-v2.account-2": { "C:\\work\\other": "nonsense" }
            }
          }
        })
      );
      expect(launcher.claudePermissionMode("C:/work/mauz/")).toBe("bypassPermissions");
      expect(launcher.claudePermissionMode("C:\\work\\other")).toBe("acceptEdits");
    }
  );

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
      expect(launcher.listAgents().find((agent) => agent.id === "codex")?.installed).toBe(true);
      await expect(
        launcher.launch({ agentId: "codex", folder, task: "Fix this error\nin the parser", context: CONTEXT })
      ).resolves.toEqual({ agentLabel: "Codex" });

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

  it("builds a hidden background start and short thread titles", () => {
    expect(
      buildHiddenStartCommand("C:\\a b\\claude.exe", ["-p", "x"], {
        logPath: "C:\\h\\agent.log",
        stdinPath: "C:\\h\\task.md"
      })
    ).toBe(
      '/d /s /c "start "" /b "C:\\a b\\claude.exe" "-p" "x" <"C:\\h\\task.md" >"C:\\h\\agent.log" 2>&1"'
    );
    expect(() => buildHiddenStartCommand("x", ['a"b'], { logPath: "l" })).toThrow();
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

describe("agent command lines", () => {
  const input = {
    folder: "C:\\work",
    briefPath: "C:\\tmp\\h\\task.md",
    handoffDirectory: "C:\\tmp\\h",
    screenshotPath: "C:\\tmp\\h\\screen.png"
  };

  it("passes the brief file, image, and folder the way each agent expects", () => {
    expect(buildAgentArguments("hermes", input)).toEqual([
      "chat",
      "--query-file",
      "C:\\tmp\\h\\task.md",
      "--image",
      "C:\\tmp\\h\\screen.png",
      "--in",
      "C:\\work"
    ]);
    expect(buildAgentArguments("codex", input)).toEqual([
      "-C",
      "C:\\work",
      "Read the task brief in C:\\tmp\\h\\task.md and carry it out.",
      "-i",
      "C:\\tmp\\h\\screen.png"
    ]);
    expect(buildAgentArguments("claude-code", input)).toEqual([
      "--add-dir",
      "C:\\tmp\\h",
      "Read the task brief in C:\\tmp\\h\\task.md and carry it out. The attached screenshot is C:\\tmp\\h\\screen.png."
    ]);
  });

  it("quotes launcher scripts so paths with quotes or spaces stay intact", () => {
    expect(
      buildPowerShellLauncher({
        title: "Mauz",
        folder: "C:\\it's here",
        executable: "C:\\a b\\x.exe",
        args: ["y"]
      })
    ).toBe(
      "$Host.UI.RawUI.WindowTitle = 'Mauz'\r\nSet-Location -LiteralPath 'C:\\it''s here'\r\n& 'C:\\a b\\x.exe' 'y'\r\n"
    );
    expect(
      buildPowerShellLauncher({ title: "Mauz → Hermes", folder: "C:\\Bob’s", executable: "x", args: [] })
    ).toBe(
      "$Host.UI.RawUI.WindowTitle = 'Mauz → Hermes'\r\nSet-Location -LiteralPath 'C:\\Bob’’s'\r\n& 'x'\r\n"
    );
    expect(buildShellLauncher({ folder: "/it's", executable: "/bin/claude", args: ["a b"] })).toBe(
      "#!/bin/bash\ncd '/it'\\''s' || exit 1\n'/bin/claude' 'a b'\n"
    );
  });

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
