import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const appRoot = resolve(__dirname, "..");
const electronPackageRoot = dirname(require.resolve("electron/package.json"));
const electronApp = resolve(electronPackageRoot, "dist/Electron.app");
const outputApp = resolve(process.env.MAUZAI_APP_OUTPUT ?? join(homedir(), "Applications/MauzAI.app"));
const resourcesDir = join(outputApp, "Contents/Resources");
const frameworksDir = join(outputApp, "Contents/Frameworks");
const packagedAppDir = join(resourcesDir, "app");
const iconPath = resolve(appRoot, "build/mauzai.icns");
const nativeInputAgent = resolve(appRoot, "../../native/macos/MauzInputAgent/MauzInputAgent.app");
const nativeInputAgentBuildScript = resolve(appRoot, "../../native/macos/MauzInputAgent/build.sh");
const nativeInputAgentStandaloneBinary = resolve(appRoot, "../../native/macos/MauzInputAgent/MauzInputAgent");
const desktopPackage = JSON.parse(await readFile(resolve(appRoot, "package.json"), "utf8"));
const version = typeof desktopPackage.version === "string" ? desktopPackage.version : "0.0.0";

if (!existsSync(electronApp)) {
  throw new Error(`Electron runtime was not found at ${electronApp}`);
}

if (!existsSync(resolve(appRoot, "out/main/index.js"))) {
  throw new Error("Desktop build output is missing. Run the desktop build before packaging.");
}

if (!existsSync(iconPath)) {
  throw new Error(`MauzAI app icon is missing at ${iconPath}`);
}

await rm(outputApp, { recursive: true, force: true });
await mkdir(dirname(outputApp), { recursive: true });
await ditto(electronApp, outputApp);

await rm(join(resourcesDir, "default_app.asar"), { force: true });
await mkdir(packagedAppDir, { recursive: true });
await cp(resolve(appRoot, "out"), join(packagedAppDir, "out"), { recursive: true });
await writeFile(
  join(packagedAppDir, "package.json"),
  `${JSON.stringify(
    {
      name: "mauzai",
      productName: "MauzAI",
      version,
      type: "module",
      main: "./out/main/index.js"
    },
    null,
    2
  )}\n`
);
await cp(iconPath, join(resourcesDir, "mauzai.icns"));
await ensureNativeInputAgent();
await copyNativeInputAgent();
await renameHelperApps();

const plist = join(outputApp, "Contents/Info.plist");
const plistUpdates = [
  ["CFBundleName", "MauzAI"],
  ["CFBundleDisplayName", "MauzAI"],
  ["CFBundleExecutable", "MauzAI"],
  ["CFBundleIdentifier", "ai.mauz.desktop"],
  ["CFBundleIconFile", "mauzai.icns"],
  ["CFBundlePackageType", "APPL"],
  ["CFBundleShortVersionString", version],
  ["CFBundleVersion", version],
  [
    "NSHumanReadableCopyright",
    "Created by FirstPoint Labs. Copyright (c) FirstPoint Labs and previous authors."
  ]
];

for (const [key, value] of plistUpdates) {
  await setPlistValue(plist, key, value);
}

await rm(join(outputApp, "Contents/MacOS/MauzAI"), { force: true });
await cp(join(outputApp, "Contents/MacOS/Electron"), join(outputApp, "Contents/MacOS/MauzAI"));
await rm(join(outputApp, "Contents/MacOS/Electron"), { force: true });
await clearCodeSignDetritus();
await signBundle();
await cleanupNativeInputAgentBuildOutput();

console.log(`Packaged ${outputApp}`);

async function ensureNativeInputAgent() {
  if (existsSync(nativeInputAgent)) {
    return;
  }

  if (process.platform !== "darwin") {
    throw new Error("MauzInputAgent.app is required for macOS packaging and can only be built on macOS.");
  }

  if (!existsSync(nativeInputAgentBuildScript)) {
    throw new Error(`Mauz input helper build script is missing at ${nativeInputAgentBuildScript}`);
  }

  await execFileAsync(nativeInputAgentBuildScript, [], {
    cwd: dirname(nativeInputAgentBuildScript)
  });

  if (!existsSync(nativeInputAgent)) {
    throw new Error(`Mauz input helper build did not produce ${nativeInputAgent}`);
  }
}

async function copyNativeInputAgent() {
  const destination = resolve(packagedAppDir, "native/macos/MauzInputAgent/MauzInputAgent.app");
  await mkdir(dirname(destination), { recursive: true });
  await ditto(nativeInputAgent, destination);
}

async function cleanupNativeInputAgentBuildOutput() {
  await rm(nativeInputAgent, { recursive: true, force: true });
  await rm(nativeInputAgentStandaloneBinary, { force: true });
}

async function renameHelperApps() {
  const helpers = [
    {
      from: "Electron Helper.app",
      to: "MauzAI Helper.app",
      executableFrom: "Electron Helper",
      executableTo: "MauzAI Helper",
      name: "MauzAI Helper",
      id: "ai.mauz.desktop.helper"
    },
    {
      from: "Electron Helper (Renderer).app",
      to: "MauzAI Helper (Renderer).app",
      executableFrom: "Electron Helper (Renderer)",
      executableTo: "MauzAI Helper (Renderer)",
      name: "MauzAI Helper (Renderer)",
      id: "ai.mauz.desktop.helper.renderer"
    },
    {
      from: "Electron Helper (GPU).app",
      to: "MauzAI Helper (GPU).app",
      executableFrom: "Electron Helper (GPU)",
      executableTo: "MauzAI Helper (GPU)",
      name: "MauzAI Helper (GPU)",
      id: "ai.mauz.desktop.helper.gpu"
    },
    {
      from: "Electron Helper (Plugin).app",
      to: "MauzAI Helper (Plugin).app",
      executableFrom: "Electron Helper (Plugin)",
      executableTo: "MauzAI Helper (Plugin)",
      name: "MauzAI Helper (Plugin)",
      id: "ai.mauz.desktop.helper.plugin"
    }
  ];

  for (const helper of helpers) {
    const fromPath = join(frameworksDir, helper.from);
    const toPath = join(frameworksDir, helper.to);

    if (!existsSync(fromPath)) {
      continue;
    }

    const macosDir = join(fromPath, "Contents/MacOS");
    await rename(join(macosDir, helper.executableFrom), join(macosDir, helper.executableTo));
    await rename(fromPath, toPath);

    const helperPlist = join(toPath, "Contents/Info.plist");
    await setPlistValue(helperPlist, "CFBundleName", helper.name);
    await setPlistValue(helperPlist, "CFBundleDisplayName", helper.name);
    await setPlistValue(helperPlist, "CFBundleExecutable", helper.executableTo);
    await setPlistValue(helperPlist, "CFBundleIdentifier", helper.id);
  }
}

async function signBundle() {
  const frameworkEntries = await readdir(frameworksDir);
  const nestedSignTargets = [
    ...frameworkEntries
      .filter((entry) => entry.endsWith(".framework"))
      .sort()
      .map((entry) => join(frameworksDir, entry)),
    ...frameworkEntries
      .filter((entry) => entry.endsWith(".app"))
      .sort()
      .map((entry) => join(frameworksDir, entry))
  ];
  const packagedInputAgent = resolve(packagedAppDir, "native/macos/MauzInputAgent/MauzInputAgent.app");

  if (existsSync(packagedInputAgent)) {
    nestedSignTargets.push(packagedInputAgent);
  }

  for (const target of nestedSignTargets) {
    await signCodeTarget(target);
  }

  await signCodeTarget(outputApp);
  await execFileAsync("codesign", ["--verify", "--deep", "--strict", outputApp]);
}

async function signCodeTarget(target) {
  await prepareCodeSignTarget(target);

  const args = ["--force", "--sign", "-"];
  const bundleIdentifier = target.endsWith(".app")
    ? await getPlistValue(join(target, "Contents/Info.plist"), "CFBundleIdentifier")
    : null;

  if (bundleIdentifier !== null) {
    args.push("--requirements", `=designated => identifier "${bundleIdentifier}"`);
  }

  args.push(target);
  await execFileAsync("codesign", args);
}

async function clearCodeSignDetritus() {
  if (process.platform !== "darwin") {
    return;
  }

  await clearExtendedAttributes(outputApp);

  for await (const path of walkPaths(outputApp)) {
    for (const attribute of [
      "com.apple.FinderInfo",
      "com.apple.ResourceFork",
      "com.apple.fileprovider.fpfs#P"
    ]) {
      try {
        await execFileAsync("xattr", ["-d", attribute, path]);
      } catch {
        // Most paths do not have each attribute.
      }
    }
  }

  await clearExtendedAttributes(outputApp);
}

async function prepareCodeSignTarget(path) {
  await clearExtendedAttributes(path);

  for (const attribute of [
    "com.apple.FinderInfo",
    "com.apple.ResourceFork",
    "com.apple.fileprovider.fpfs#P"
  ]) {
    try {
      await execFileAsync("xattr", ["-d", attribute, path]);
    } catch {
      // Most paths do not have each attribute.
    }
  }
}

async function clearExtendedAttributes(path) {
  try {
    await execFileAsync("xattr", ["-cr", path]);
  } catch {
    // Some nested paths may not support recursive extended attribute cleanup.
  }
}

async function ditto(source, destination) {
  if (process.platform === "darwin") {
    await execFileAsync("ditto", ["--norsrc", source, destination]);
    return;
  }

  await cp(source, destination, { recursive: true });
}

async function* walkPaths(path) {
  yield path;

  const stat = await lstat(path);
  if (!stat.isDirectory()) {
    return;
  }

  for (const entry of await readdir(path)) {
    yield* walkPaths(join(path, entry));
  }
}

async function setPlistValue(plistPath, key, value) {
  try {
    await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath]);
  } catch {
    await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plistPath]);
  }
}

async function getPlistValue(plistPath, key) {
  try {
    const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plistPath]);
    const value = stdout.trim();

    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}
