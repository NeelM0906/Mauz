import { execFile } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { BrowserPageSchema, isBlockedSite, type BrowserPage } from "@mauzai/shared";
import type { BrowserPageReader, BrowserPageResult } from "./ContextCollector";

const BROWSER_HOST_NAME = "ai.mauz.browser";
/** Fixed by the "key" in browser-extension/extension/manifest.json. */
export const BROWSER_EXTENSION_ID = "lnahcdbpmfglahakbckmgbfgbclaaiog";

// The page is read while the popover is about to open; a slow browser is skipped.
const SNAPSHOT_TIMEOUT_MS = 400;
const MAX_LINE_CHARS = 2_000_000;

/** Browser program names (Windows) and bundle ids (macOS) to the name the extension reports. */
const BROWSER_NAMES: Record<string, string> = {
  "msedge.exe": "Microsoft Edge",
  "com.microsoft.edgemac": "Microsoft Edge",
  "chrome.exe": "Google Chrome",
  "com.google.chrome": "Google Chrome",
  "brave.exe": "Brave",
  "com.brave.browser": "Brave",
  "vivaldi.exe": "Vivaldi",
  "com.vivaldi.vivaldi": "Vivaldi",
  "opera.exe": "Opera",
  "com.operasoftware.opera": "Opera"
};

type HostConnection = {
  socket: Socket;
  browser: string | null;
  buffer: string;
  pending: Map<number, (result: unknown) => void>;
  /** True once the host proved it knows the shared secret. */
  authenticated: boolean;
  /** Mauz's challenge to the host. */
  nonce: string;
};

type SnapshotResult = {
  result: BrowserPageResult | undefined;
  focused: boolean;
};

// A host that has not authenticated by then is dropped.
const AUTH_TIMEOUT_MS = 5_000;

/**
 * Talks to the Mauz browser extension through its native messaging host, which connects to
 * this local pipe (Windows) or Unix socket. One connection per running browser profile.
 *
 * Mauz and the host prove to each other that they know a secret that only this user's launcher
 * holds, so another local user who claims the pipe name first can neither read pages nor feed
 * Mauz fake ones.
 */
export class BrowserBridge implements BrowserPageReader {
  private server: Server | null = null;
  private readonly connections = new Set<HostConnection>();
  private nextRequestId = 1;

  constructor(
    private readonly pipePath: string,
    private readonly token: string
  ) {}

  async start(): Promise<void> {
    if (this.server !== null) {
      return;
    }

    if (process.platform !== "win32") {
      // A socket file left by a crashed run blocks listen().
      await unlink(this.pipePath).catch(() => {});
    }

    const server = createServer((socket) => this.accept(socket));

    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.pipePath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    server.on("error", () => {
      // Keep running; reading pages is optional.
    });
    this.server = server;
  }

  stop(): void {
    for (const connection of this.connections) {
      connection.socket.destroy();
    }

    this.connections.clear();
    this.server?.close();
    this.server = null;
  }

  /** Browsers whose extension is connected right now, for Settings. */
  connectedBrowsers(): string[] {
    return [
      ...new Set(
        [...this.connections]
          .filter((connection) => connection.authenticated)
          .map((connection) => connection.browser)
          .filter(isString)
      )
    ];
  }

  /**
   * Asks every connected profile of that browser. A never-capture site in any of them blocks;
   * otherwise the page comes from the profile whose window is focused, or the only profile.
   */
  async readPage(
    executable: string,
    blockedSites: readonly string[]
  ): Promise<BrowserPageResult | undefined> {
    const browser = BROWSER_NAMES[executable.trim().toLowerCase()];
    const connections = [...this.connections].filter(
      (connection) =>
        connection.authenticated && connection.browser !== null && connection.browser === browser
    );

    if (connections.length === 0) {
      return undefined;
    }

    const snapshots = await Promise.all(
      connections.map((connection) => this.requestSnapshot(connection, blockedSites))
    );

    return chooseSnapshot(snapshots);
  }

  private async requestSnapshot(
    connection: HostConnection,
    blockedSites: readonly string[]
  ): Promise<SnapshotResult> {
    const id = this.nextRequestId++;
    const result = await new Promise<unknown>((resolve) => {
      const timer = setTimeout(() => {
        connection.pending.delete(id);
        resolve(undefined);
      }, SNAPSHOT_TIMEOUT_MS);

      connection.pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      connection.socket.write(`${JSON.stringify({ type: "snapshot", id, blockedSites })}\n`);
    });

    return {
      result: parseSnapshotResult(result, blockedSites),
      focused: isRecord(result) && result.focused === true
    };
  }

  private accept(socket: Socket): void {
    const connection: HostConnection = {
      socket,
      browser: null,
      buffer: "",
      pending: new Map(),
      authenticated: false,
      nonce: randomBytes(32).toString("hex")
    };
    const authTimer = setTimeout(() => {
      if (!connection.authenticated) {
        socket.destroy();
      }
    }, AUTH_TIMEOUT_MS);

    this.connections.add(connection);
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      connection.buffer += chunk;

      if (connection.buffer.length > MAX_LINE_CHARS) {
        socket.destroy();
        return;
      }

      let newline = connection.buffer.indexOf("\n");

      while (newline >= 0) {
        const line = connection.buffer.slice(0, newline).trim();
        connection.buffer = connection.buffer.slice(newline + 1);
        this.handleMessage(connection, line);
        newline = connection.buffer.indexOf("\n");
      }
    });
    socket.on("error", () => {
      // "close" follows.
    });
    socket.on("close", () => {
      clearTimeout(authTimer);
      this.connections.delete(connection);

      for (const resolve of connection.pending.values()) {
        resolve(undefined);
      }

      connection.pending.clear();
    });
  }

  private handleMessage(connection: HostConnection, line: string): void {
    let message: unknown;

    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (!isRecord(message)) {
      return;
    }

    if (!connection.authenticated) {
      this.handleHandshake(connection, message);
      return;
    }

    if (message.type === "hello" && typeof message.browser === "string") {
      connection.browser = message.browser.slice(0, 80);
      return;
    }

    if (message.type === "snapshot-result" && typeof message.id === "number") {
      const resolve = connection.pending.get(message.id);

      connection.pending.delete(message.id);
      resolve?.(message.result);
    }
  }

  /** The host challenges Mauz first, then answers Mauz's challenge. */
  private handleHandshake(connection: HostConnection, message: Record<string, unknown>): void {
    if (message.type === "challenge" && typeof message.nonce === "string" && message.nonce.length <= 128) {
      connection.socket.write(
        `${JSON.stringify({ type: "proof", proof: signNonce(this.token, "mauz", message.nonce), nonce: connection.nonce })}\n`
      );
      return;
    }

    if (message.type === "auth" && typeof message.proof === "string") {
      if (proofMatches(message.proof, signNonce(this.token, "host", connection.nonce))) {
        connection.authenticated = true;
        return;
      }
    }

    connection.socket.destroy();
  }
}

/** Blocked anywhere wins; then the focused profile; then the only profile. */
export function chooseSnapshot(snapshots: readonly SnapshotResult[]): BrowserPageResult | undefined {
  const blocked = snapshots.find(
    (snapshot) => snapshot.result !== undefined && "blockedHost" in snapshot.result
  );

  if (blocked !== undefined) {
    return blocked.result;
  }

  const answered = snapshots.filter((snapshot) => snapshot.result !== undefined);
  const focused = answered.filter((snapshot) => snapshot.focused);

  if (focused.length === 1) {
    return focused[0]!.result;
  }

  return snapshots.length === 1 ? answered[0]?.result : undefined;
}

/** HMAC of a nonce with the shared secret; the role keeps the two directions distinct. */
function signNonce(token: string, role: "mauz" | "host", nonce: string): string {
  return createHmac("sha256", token).update(`${role}:${nonce}`).digest("hex");
}

function proofMatches(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

/** The shared secret, created once per install in a folder only this user can read. */
export async function loadOrCreateBrowserToken(directory: string): Promise<string> {
  const tokenPath = join(directory, "token");

  try {
    const existing = (await readFile(tokenPath, "utf8")).trim();

    if (/^[0-9a-f]{64}$/.test(existing)) {
      return existing;
    }
  } catch {
    // Created below.
  }

  const token = randomBytes(32).toString("hex");

  await writeTextFileWithDirectory(tokenPath, token);
  await chmod(tokenPath, 0o600).catch(() => {});

  return token;
}

/** Validates what the extension sent and checks the site against the never-capture list again. */
export function parseSnapshotResult(
  result: unknown,
  blockedSites: readonly string[]
): BrowserPageResult | undefined {
  if (!isRecord(result)) {
    return undefined;
  }

  if (typeof result.blockedHost === "string" && result.blockedHost.length > 0) {
    return { blockedHost: result.blockedHost.slice(0, 500) };
  }

  const parsed = BrowserPageSchema.safeParse(result.page);

  if (!parsed.success) {
    return undefined;
  }

  const host = getHost(parsed.data.url);

  if (host === undefined) {
    return undefined;
  }

  if (isBlockedSite(host, blockedSites)) {
    return { blockedHost: host };
  }

  return { page: withoutEmptyFields(parsed.data) };
}

export function getBrowserPipePath(userDataDir: string, username: string): string {
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mauz-browser-${username.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  }

  return join(userDataDir, "browser.sock");
}

type RegisterNativeHostOptions = {
  hostScriptPath: string;
  /** Where the launcher and host manifest are written. */
  installDir: string;
  /** Electron's binary; it runs the host as Node via ELECTRON_RUN_AS_NODE. */
  execPath: string;
  pipePath: string;
  /** Shared secret the host uses to authenticate with Mauz. */
  token: string;
  platform?: NodeJS.Platform;
  writeTextFile?: (path: string, contents: string) => Promise<void>;
  runReg?: (args: string[]) => Promise<void>;
};

/**
 * Registers the native messaging host with Chrome and Edge for the current user, so the
 * extension can reach Mauz. Rewritten on every start, which keeps paths current.
 */
export async function registerNativeHost(options: RegisterNativeHostOptions): Promise<void> {
  const platform = options.platform ?? process.platform;
  const writeTextFile = options.writeTextFile ?? writeTextFileWithDirectory;

  if (platform === "win32") {
    const launcherPath = join(options.installDir, "mauz-browser-host.cmd");
    const manifestPath = join(options.installDir, `${BROWSER_HOST_NAME}.json`);
    const runReg = options.runReg ?? runRegCommand;

    await writeTextFile(launcherPath, buildWindowsLauncher(options));
    await writeTextFile(manifestPath, buildHostManifest(launcherPath));

    for (const browserKey of ["Software\\Google\\Chrome", "Software\\Microsoft\\Edge"]) {
      await runReg([
        "add",
        `HKCU\\${browserKey}\\NativeMessagingHosts\\${BROWSER_HOST_NAME}`,
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        manifestPath,
        "/f"
      ]);
    }

    return;
  }

  if (platform === "darwin") {
    const launcherPath = join(options.installDir, "mauz-browser-host");
    const support = join(homedir(), "Library", "Application Support");

    await writeTextFile(launcherPath, buildPosixLauncher(options));
    // The launcher holds the shared secret: runnable and readable by this user only.
    await chmod(launcherPath, 0o700).catch(() => {});

    for (const browserDir of ["Google/Chrome", "Microsoft Edge"]) {
      await writeTextFile(
        join(support, browserDir, "NativeMessagingHosts", `${BROWSER_HOST_NAME}.json`),
        buildHostManifest(launcherPath)
      );
    }
  }
}

export function buildWindowsLauncher(
  options: Pick<RegisterNativeHostOptions, "execPath" | "hostScriptPath" | "pipePath" | "token">
): string {
  // In a .cmd file, % starts a variable; double it so paths are taken literally.
  const literal = (value: string) => value.replace(/%/g, "%%");

  return [
    "@echo off",
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "MAUZ_BROWSER_PIPE=${literal(options.pipePath)}"`,
    `set "MAUZ_BROWSER_TOKEN=${options.token}"`,
    `"${literal(options.execPath)}" "${literal(options.hostScriptPath)}" %*`,
    ""
  ].join("\r\n");
}

function buildPosixLauncher(
  options: Pick<RegisterNativeHostOptions, "execPath" | "hostScriptPath" | "pipePath" | "token">
): string {
  const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

  return [
    "#!/bin/sh",
    "export ELECTRON_RUN_AS_NODE=1",
    `export MAUZ_BROWSER_PIPE=${quote(options.pipePath)}`,
    `export MAUZ_BROWSER_TOKEN=${quote(options.token)}`,
    `exec ${quote(options.execPath)} ${quote(options.hostScriptPath)} "$@"`,
    ""
  ].join("\n");
}

export function buildHostManifest(launcherPath: string): string {
  return `${JSON.stringify(
    {
      name: BROWSER_HOST_NAME,
      description: "Lets the Mauz browser extension send the page under the pointer to Mauz.",
      path: launcherPath,
      type: "stdio",
      allowed_origins: [`chrome-extension://${BROWSER_EXTENSION_ID}/`]
    },
    null,
    2
  )}\n`;
}

async function writeTextFileWithDirectory(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
}

async function runRegCommand(args: string[]): Promise<void> {
  await promisify(execFile)("reg.exe", args, { windowsHide: true });
}

function withoutEmptyFields(page: BrowserPage): BrowserPage {
  return JSON.parse(JSON.stringify(page)) as BrowserPage;
}

function getHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);

    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.hostname : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: string | null): value is string {
  return value !== null;
}
