import { execFile, spawn } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { buildCliEnvironment } from "@mauzai/api/server";

// How TaskAgentLauncher starts an agent: its arguments, the launcher script, its environment, and
// the functions that start the process.

export type StartProcessOptions = {
  env: NodeJS.ProcessEnv;
};

export type StartHiddenOptions = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  logPath: string;
  stdinPath?: string;
};

export type WindowsBackgroundAppLaunch = {
  processNames: readonly string[];
  url: string;
};

/**
 * Activates an installed Windows protocol handler without letting a newly launched app take focus.
 * An app the user already has open keeps its current window behavior.
 */
export function buildWindowsBackgroundAppLaunchScript(launch: WindowsBackgroundAppLaunch): string {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;
  const names = launch.processNames.map(quote).join(", ");
  const url = quote(launch.url);

  return [
    `$running = Get-Process -Name @(${names}) -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }`,
    "if ($null -eq $running) {",
    `  Start-Process -FilePath ${url} -WindowStyle Minimized`,
    "} else {",
    `  Start-Process -FilePath ${url}`,
    "}"
  ].join("\r\n");
}

export async function openWindowsAgentAppInBackground(launch: WindowsBackgroundAppLaunch): Promise<void> {
  await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      buildWindowsBackgroundAppLaunchScript(launch)
    ],
    { windowsHide: true, timeout: 15_000 }
  );
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
      ([key]) =>
        key.toUpperCase() !== "OPENAI_ASK_MODEL" &&
        !PARENT_SESSION_VARIABLE.test(key) &&
        !/^HERMES_(YOLO_MODE|IGNORE_RULES)$/i.test(key)
    )
  );
}

export function startDetached(command: string, args: string[], options: StartProcessOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: options.env
    });

    child.once("error", (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function startHiddenProcess(
  command: string,
  args: string[],
  options: StartHiddenOptions
): Promise<void> {
  const log = openSync(options.logPath, "a", 0o600);
  let input: number | undefined;

  try {
    input = options.stdinPath === undefined ? undefined : openSync(options.stdinPath, "r");

    await new Promise<void>((resolve, reject) => {
      // Detached children have no inherited console and can finish after Mauz exits.
      // On Windows, this also prevents libuv from adding the child to Mauz's job object.
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: [input ?? "ignore", log, log],
        windowsHide: true
      });

      child.once("error", (error) => reject(new Error(`Could not start the agent: ${error.message}`)));
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  } finally {
    if (input !== undefined) closeSync(input);
    closeSync(log);
  }
}

/** Runs a bounded vendor discovery or capability command without showing a console. */
export async function readAgentOutput(
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd: string;
  }
): Promise<string> {
  const { stdout } = await promisify(execFile)(command, args, {
    ...options,
    windowsHide: true,
    maxBuffer: 256 * 1024,
    timeout: 30_000
  });

  return stdout;
}

export async function openMacAgentApplication(bundle: string, url: string): Promise<void> {
  await promisify(execFile)("/usr/bin/open", ["-a", bundle, url], { timeout: 15_000 });
}

export async function openMacAgentApplicationInBackground(bundle: string, url: string): Promise<void> {
  await promisify(execFile)("/usr/bin/open", ["-g", "-a", bundle, url], { timeout: 15_000 });
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
