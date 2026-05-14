import { execFile } from "node:child_process";

export type AppleScriptRunner = (script: string, args?: readonly string[]) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 900;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

export const runJavaScriptForAutomation: AppleScriptRunner = (script, args = []) =>
  new Promise((resolve, reject) => {
    execFile(
      "osascript",
      ["-l", "JavaScript", "-e", script, ...args],
      {
        timeout: DEFAULT_TIMEOUT_MS,
        maxBuffer: DEFAULT_MAX_BUFFER
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
