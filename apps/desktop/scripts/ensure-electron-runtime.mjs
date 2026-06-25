import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const electronPackageRoot = dirname(require.resolve("electron/package.json"));
const electronApp = resolve(electronPackageRoot, "dist/Electron.app");
const electronInstallScript = resolve(electronPackageRoot, "install.js");

if (existsSync(electronApp)) {
  console.log(`Electron runtime is available at ${electronApp}`);
  process.exit(0);
}

console.log("Electron runtime is missing; downloading Electron.app...");
await execFileAsync(process.execPath, [electronInstallScript], {
  cwd: electronPackageRoot,
  maxBuffer: 1024 * 1024 * 10
});

if (!existsSync(electronApp)) {
  throw new Error(`Electron install completed but ${electronApp} was not created.`);
}

console.log(`Electron runtime is available at ${electronApp}`);
