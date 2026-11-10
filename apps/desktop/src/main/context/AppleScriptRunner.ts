import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type AppleScriptRunner = (script: string, args?: readonly string[]) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 900;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

const execFileAsync = promisify(execFile);

export const runJavaScriptForAutomation: AppleScriptRunner = async (script, args = []) => {
  const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script, ...args], {
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: DEFAULT_MAX_BUFFER
  });

  return stdout.trim();
};
