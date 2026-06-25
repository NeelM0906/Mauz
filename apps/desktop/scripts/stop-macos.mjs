import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const appRoots = [
  "/Applications/MauzAI.app",
  resolve(homedir(), "Applications/MauzAI.app"),
  resolve(repoRoot, "dist/mac/MauzAI.app")
];
const executablePrefixes = appRoots.flatMap((appRoot) => [
  `${appRoot}/Contents/MacOS/MauzAI`,
  `${appRoot}/Contents/Frameworks/MauzAI Helper`,
  `${appRoot}/Contents/Resources/app/native/macos/MauzInputAgent/`
]);

const pids = new Set();
const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);

for (const line of stdout.split(/\r?\n/)) {
  const trimmed = line.trim();
  const match = trimmed.match(/^(\d+)\s+(.+)$/);

  if (match === null) {
    continue;
  }

  const pid = Number.parseInt(match[1], 10);
  const command = match[2];

  if (
    Number.isInteger(pid) &&
    pid > 0 &&
    pid !== process.pid &&
    executablePrefixes.some((prefix) => command.startsWith(prefix))
  ) {
    pids.add(pid);
  }
}

if (pids.size === 0) {
  console.log("No running MauzAI app processes found.");
  process.exit(0);
}

const pidList = [...pids].sort((a, b) => a - b);
console.log(`Stopping MauzAI processes: ${pidList.join(", ")}`);

for (const pid of pidList) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

await delay(1200);

for (const pid of pidList) {
  try {
    process.kill(pid, 0);
    process.kill(pid, "SIGKILL");
  } catch {
    // Process exited after SIGTERM.
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
