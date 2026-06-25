import { mkdir, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const installedApp = "/Applications/MauzAI.app";
const localAppLinks = [
  resolve(repoRoot, "dist/mac/MauzAI.app"),
  resolve(homedir(), "Applications/MauzAI.app")
];

if (process.platform !== "darwin") {
  throw new Error("macOS app linking requires macOS.");
}

if (!existsSync(installedApp)) {
  throw new Error(`MauzAI.app is missing at ${installedApp}. Run the macOS install step first.`);
}

for (const localAppLink of localAppLinks) {
  if (localAppLink === installedApp) {
    continue;
  }

  await rm(localAppLink, { recursive: true, force: true });
  await mkdir(dirname(localAppLink), { recursive: true });
  await symlink(installedApp, localAppLink);

  console.log(`Linked ${localAppLink} -> ${installedApp}`);
}
