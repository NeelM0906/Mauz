import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

export type ResolvedCliCommand = {
  command: string;
  args: string[];
  /** Extra environment needed to run the command (for example when Electron runs a JS shim as Node). */
  env?: Record<string, string> | undefined;
};

export type CliResolutionOptions = {
  platform?: NodeJS.Platform | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  homeDirectory?: string | undefined;
  pathExists?: ((path: string) => boolean) | undefined;
  readTextFile?: ((path: string) => string) | undefined;
  /** Runtime used to run npm JS shims when no node.exe is available (Electron sets ELECTRON_RUN_AS_NODE). */
  fallbackNodeRuntime?: string | undefined;
};

type PathApi = typeof posix;

/** Variables that point Mauz at a CLI outside the folders it searches. */
const CLI_PATH_VARIABLES: Readonly<Record<string, string>> = {
  claude: "MAUZ_CLAUDE_CODE_PATH",
  codex: "MAUZ_CODEX_PATH"
};

/** The path set in the CLI's MAUZ_*_PATH variable, or the name itself. */
export function applyCliPathOverride(name: string, env: NodeJS.ProcessEnv): string {
  const variable = CLI_PATH_VARIABLES[name];

  return (variable === undefined ? undefined : env[variable]?.trim()) || name;
}

/**
 * Finds a CLI such as `claude` or `codex` the same way a terminal would, plus the
 * install locations GUI launches miss. On Windows, npm installs `.cmd` shims that
 * cannot be spawned without a shell, so those resolve to `node <entry.js>` instead.
 */
export function resolveCliCommand(
  cliName: string,
  options: CliResolutionOptions = {}
): ResolvedCliCommand | null {
  const platform = options.platform ?? process.platform;
  const pathApi: PathApi = platform === "win32" ? win32 : posix;
  const env = options.env ?? process.env;
  const pathExists = options.pathExists ?? existsSync;
  const readTextFile = options.readTextFile ?? ((path: string) => readFileSync(path, "utf8"));
  const home = options.homeDirectory ?? homedir();
  const name = applyCliPathOverride(cliName, env);

  if (pathApi.isAbsolute(name)) {
    if (!pathExists(name)) {
      return null;
    }

    return platform === "win32" && /\.(cmd|bat)$/i.test(name)
      ? resolveNpmShim(name, pathApi, pathExists, readTextFile, env, options)
      : { command: name, args: [] };
  }

  const searchDirectories = getCliSearchDirectories(platform, env, home);

  if (platform !== "win32") {
    return findFirst(searchDirectories, name, pathApi, pathExists);
  }

  const executable = findFirst(searchDirectories, `${name}.exe`, pathApi, pathExists);

  if (executable !== null) {
    return executable;
  }

  for (const directory of searchDirectories) {
    const shim = pathApi.join(directory, `${name}.cmd`);

    if (pathExists(shim)) {
      const resolved = resolveNpmShim(shim, pathApi, pathExists, readTextFile, env, options);

      if (resolved !== null) {
        return resolved;
      }
    }
  }

  return null;
}

/** Keys that would make a CLI bill an API key Mauz holds instead of the user's subscription. */
const CREDENTIAL_KEYS = new Set(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]);

/**
 * Child processes must not inherit Mauz's own settings and secrets, API credentials, or
 * Electron's run-as-Node switch. Names are compared in upper case, as Windows does.
 */
export function buildCliEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => {
      const name = key.toUpperCase();

      return !name.startsWith("MAUZ_") && name !== "ELECTRON_RUN_AS_NODE" && !CREDENTIAL_KEYS.has(name);
    })
  );
}

function findFirst(
  directories: readonly string[],
  fileName: string,
  pathApi: PathApi,
  pathExists: (path: string) => boolean
): ResolvedCliCommand | null {
  for (const directory of directories) {
    const candidate = pathApi.join(directory, fileName);

    if (pathExists(candidate)) {
      return { command: candidate, args: [] };
    }
  }

  return null;
}

function resolveNpmShim(
  shimPath: string,
  pathApi: PathApi,
  pathExists: (path: string) => boolean,
  readTextFile: (path: string) => string,
  env: NodeJS.ProcessEnv,
  options: CliResolutionOptions
): ResolvedCliCommand | null {
  let shimSource: string;

  try {
    shimSource = readTextFile(shimPath);
  } catch {
    return null;
  }

  // npm cmd-shims end with: "%_prog%"  "%dp0%\node_modules\<pkg>\bin\cli.js" %*
  const entryMatch = /"%~?dp0%?\\([^"]+\.(?:c|m)?js)"/i.exec(shimSource);

  if (entryMatch === null) {
    return null;
  }

  const shimDirectory = pathApi.dirname(shimPath);
  const entryPath = pathApi.resolve(shimDirectory, entryMatch[1]!);

  if (!pathExists(entryPath)) {
    return null;
  }

  const bundledNode = pathApi.join(shimDirectory, "node.exe");

  if (pathExists(bundledNode)) {
    return { command: bundledNode, args: [entryPath] };
  }

  const nodeOnPath = findFirst(splitPath(env, pathApi), "node.exe", pathApi, pathExists);

  if (nodeOnPath !== null) {
    return { command: nodeOnPath.command, args: [entryPath] };
  }

  if (options.fallbackNodeRuntime !== undefined) {
    return {
      command: options.fallbackNodeRuntime,
      args: [entryPath],
      env: { ELECTRON_RUN_AS_NODE: "1" }
    };
  }

  return null;
}

/** PATH, then the install folders that GUI launches (Start menu, Finder) can miss. Ask and Send to agent share it. */
export function getCliSearchDirectories(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  const pathApi: PathApi = platform === "win32" ? win32 : posix;
  const extraDirectories =
    platform === "win32"
      ? [
          pathApi.join(home, ".local", "bin"),
          ...(env.APPDATA ? [pathApi.join(env.APPDATA, "npm")] : []),
          ...(env.LOCALAPPDATA ? [pathApi.join(env.LOCALAPPDATA, "hermes", "bin")] : [])
        ]
      : [
          pathApi.join(home, ".local", "bin"),
          pathApi.join(home, ".claude", "local"),
          pathApi.join(home, ".npm-global", "bin"),
          pathApi.join(home, ".bun", "bin"),
          pathApi.join(home, ".hermes", "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin"
        ];

  return [...new Set([...splitPath(env, pathApi), ...extraDirectories])];
}

function splitPath(env: NodeJS.ProcessEnv, pathApi: PathApi): string[] {
  const rawPath = env.PATH ?? env.Path ?? "";

  return rawPath
    .split(pathApi.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry.length > 0);
}

/**
 * Finds npm for installing a missing CLI. On Windows npm's own `npm.cmd` is not a regular
 * package shim, so run `npm-cli.js` with the Node.js it ships next to.
 */
export function resolveNpmCommand(options: CliResolutionOptions = {}): ResolvedCliCommand | null {
  const platform = options.platform ?? process.platform;

  if (platform !== "win32") {
    return resolveCliCommand("npm", options);
  }

  const pathExists = options.pathExists ?? existsSync;
  const node = resolveCliCommand("node", options);

  if (node === null) {
    return null;
  }

  const npmCli = win32.join(win32.dirname(node.command), "node_modules", "npm", "bin", "npm-cli.js");

  return pathExists(npmCli) ? { command: node.command, args: [npmCli] } : null;
}
