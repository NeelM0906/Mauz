import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { buildCliEnvironment } from "@mauzai/api/server";
import type { TaskAgentId } from "@mauzai/shared";

// How TaskAgentLauncher starts an agent: its arguments, the launcher script, its environment, and
// the functions that start the process.

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

  // The Claude Code terminal cannot take an attachment, so it reads the screenshot from the hand-off folder.
  const screenshot =
    input.screenshotPath === undefined ? "" : ` The attached screenshot is ${input.screenshotPath}.`;

  return ["--add-dir", input.handoffDirectory, `${prompt}${screenshot}`];
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

/**
 * Set by a Claude Code (or T3 Code) session that started Mauz. Inherited, they make the agent's
 * run a child of that session instead of a session of its own.
 */
const PARENT_SESSION_VARIABLE =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_AGENT_SDK_VERSION|CLAUDE_CODE_(ENTRYPOINT|EXECPATH|SESSION_.*|CHILD_SESSION|MESSAGING_.*)|T3CODE_.*)$/i;

/**
 * What Ask's CLIs do not get (buildCliEnvironment), plus Mauz's Ask model setting and a parent
 * agent session.
 */
export function buildAgentEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(buildCliEnvironment(env)).filter(
      ([key]) => key.toUpperCase() !== "OPENAI_ASK_MODEL" && !PARENT_SESSION_VARIABLE.test(key)
    )
  );
}

export function startDetached(command: string, args: string[], options: StartProcessOptions): Promise<void> {
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

export function startHiddenProcess(
  command: string,
  args: string[],
  options: StartHiddenOptions
): Promise<void> {
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
export async function findCodexAppExecutable(): Promise<string | null> {
  const location = await promisify(execFile)(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "(Get-AppxPackage -Name OpenAI.Codex).InstallLocation"],
    { windowsHide: true, timeout: 15_000 }
  ).then(
    ({ stdout }) => stdout.trim().split(/\r?\n/)[0]?.trim(),
    () => undefined
  );

  if (location === undefined || location.length === 0) {
    return null;
  }

  const executable = win32.join(location, "app", "resources", "codex.exe");

  return existsSync(executable) ? executable : null;
}
