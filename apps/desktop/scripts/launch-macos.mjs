import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const appPath = resolve(process.env.MAUZAI_APP_OUTPUT ?? `${homedir()}/Applications/MauzAI.app`);

if (!existsSync(appPath)) {
  throw new Error(
    `MauzAI.app is missing at ${appPath}. Run \`pnpm --filter @mauzai/desktop package:mac\` first.`
  );
}

await execFileAsync("open", [appPath]);
console.log(`Launched ${appPath}`);
