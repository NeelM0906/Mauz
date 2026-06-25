import { mkdir, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const installedApp = resolve(process.env.MAUZAI_INSTALLED_APP ?? "/Applications/MauzAI.app");
const localAppLink = resolve(process.env.MAUZAI_LOCAL_APP_LINK ?? resolve(repoRoot, "dist/mac/MauzAI.app"));

if (process.platform !== "darwin") {
  throw new Error("macOS app linking requires macOS.");
}

if (!existsSync(installedApp)) {
  throw new Error(`MauzAI.app is missing at ${installedApp}. Run the macOS install step first.`);
}

await rm(localAppLink, { recursive: true, force: true });
await mkdir(dirname(localAppLink), { recursive: true });
await symlink(installedApp, localAppLink);

console.log(`Linked ${localAppLink} -> ${installedApp}`);
