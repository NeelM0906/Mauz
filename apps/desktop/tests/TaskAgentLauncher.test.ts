import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import {
  buildAgentArguments,
  buildAgentEnvironment,
  buildPowerShellLauncher,
  buildShellLauncher,
  TaskAgentLauncher
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

  it("writes the brief and screenshot, then opens the agent in a terminal", async () => {
    const home = createHome();
    const temp = createHome();
    const folder = join(home, "work");
    mkdirSync(folder);
    const startProcess = vi.fn(async () => {});
    const launcher = new TaskAgentLauncher({
      platform: "win32",
      env: { PATH: "", LOCALAPPDATA: join(home, "local"), ELECTRON_RUN_AS_NODE: "1", MAUZ_LOCAL_TOKEN: "x" },
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

    expect(brief).toContain("<task>\nFix this error\n</task>");
    expect(brief).toContain("<selected_text>\nTypeError: x is undefined\n</selected_text>");
    expect(brief).toContain(`<image>${join(handoff, "screen.png")} (crop framed on the pointed element`);
    expect(readFileSync(join(handoff, "screen.png"), "utf8")).toBe("png-bytes");
    expect(script).toContain(`Set-Location -LiteralPath '${folder}'`);
    expect(script).toContain("'chat' '--query-file'");
    expect(script).toContain("'--image'");
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
      "Read the task brief in C:\\tmp\\h\\task.md and carry it out."
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
    expect(buildShellLauncher({ folder: "/it's", executable: "/bin/claude", args: ["a b"] })).toBe(
      "#!/bin/bash\ncd '/it'\\''s' || exit 1\n'/bin/claude' 'a b'\n"
    );
  });

  it("keeps the user's environment but drops Mauz and Electron variables", () => {
    expect(buildAgentEnvironment({ PATH: "p", MAUZ_X: "1", ELECTRON_RUN_AS_NODE: "1" })).toEqual({
      PATH: "p"
    });
  });
});
