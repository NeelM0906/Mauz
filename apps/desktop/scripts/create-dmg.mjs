import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const desktopPackage = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
const version = typeof desktopPackage.version === "string" ? desktopPackage.version : "0.0.0";
const appPath = resolve(process.env.MAUZAI_DMG_APP_PATH ?? resolve(repoRoot, "dist/mac/MauzAI.app"));
const outputDir = resolve(process.env.MAUZAI_DMG_OUTPUT_DIR ?? resolve(repoRoot, "dist"));
const volumeName = process.env.MAUZAI_DMG_VOLUME_NAME ?? "MauzAI";
const architecture = await detectArchitecture(appPath);
const dmgName = process.env.MAUZAI_DMG_NAME ?? `MauzAI-${version}-${architecture}.dmg`;
const outputPath = resolve(outputDir, dmgName);
const stagingRoot = await mkdtemp(join(tmpdir(), "mauzai-dmg-"));
const stagingDir = join(stagingRoot, "staging");

if (process.platform !== "darwin") {
  throw new Error("DMG packaging requires macOS.");
}

if (!existsSync(appPath)) {
  throw new Error(`MauzAI.app is missing at ${appPath}. Run the macOS package step first.`);
}

await rm(stagingDir, { recursive: true, force: true });
await mkdir(stagingDir, { recursive: true });
await execFileAsync("ditto", ["--norsrc", appPath, join(stagingDir, "MauzAI.app")]);
await symlink("/Applications", join(stagingDir, "Applications"));
await writeFile(
  join(stagingDir, "README.txt"),
  [
    "Install MauzAI",
    "",
    "Drag MauzAI.app into the Applications shortcut in this disk image.",
    "Then open MauzAI from Applications.",
    "",
    "This build is signed locally unless a Developer ID certificate was used during packaging."
  ].join("\n")
);

await mkdir(outputDir, { recursive: true });
await rm(outputPath, { force: true });
await execFileAsync("hdiutil", [
  "create",
  "-volname",
  volumeName,
  "-srcfolder",
  stagingDir,
  "-ov",
  "-format",
  "UDZO",
  outputPath
]);
await execFileAsync("hdiutil", ["verify", outputPath]);
await rm(stagingRoot, { recursive: true, force: true });

console.log(`Created ${outputPath}`);

async function detectArchitecture(path) {
  const executablePath = join(path, "Contents/MacOS/MauzAI");

  try {
    const { stdout } = await execFileAsync("lipo", ["-archs", executablePath]);
    const architectures = stdout.trim().split(/\s+/).filter(Boolean);

    if (architectures.length > 1) {
      return "universal";
    }

    if (architectures[0] === "x86_64") {
      return "x64";
    }

    return architectures[0] ?? process.arch;
  } catch {
    return process.arch;
  }
}
