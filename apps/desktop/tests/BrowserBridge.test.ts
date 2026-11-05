import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_EXTENSION_ID,
  BrowserBridge,
  buildHostManifest,
  buildWindowsLauncher,
  chooseSnapshot,
  parseSnapshotResult,
  registerNativeHost
} from "../src/main/context/BrowserBridge";

const HOST_SCRIPT = resolve(__dirname, "../../../browser-extension/native-host/host.cjs");

const TOKEN = "a".repeat(64);

function testPipePath(): string {
  // macOS limits socket paths to about 103 bytes, and its tmpdir is long; keep this short.
  return process.platform === "win32"
    ? `\\\\.\\pipe\\mauz-browser-test-${randomUUID()}`
    : join("/tmp", `mz-${randomUUID().slice(0, 8)}.sock`);
}

/** Runs the real native host the way Chrome does: framed JSON over stdio. */
function startHost(pipePath: string, token = TOKEN) {
  const child = spawn(process.execPath, [HOST_SCRIPT], {
    env: { ...process.env, MAUZ_BROWSER_PIPE: pipePath, MAUZ_BROWSER_TOKEN: token },
    stdio: ["pipe", "pipe", "pipe"]
  }) as ChildProcessWithoutNullStreams;
  const received: unknown[] = [];
  let buffer = Buffer.alloc(0);

  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const length = buffer.readUInt32LE(0);
      received.push(JSON.parse(buffer.subarray(4, 4 + length).toString("utf8")));
      buffer = buffer.subarray(4 + length);
    }
  });

  return {
    child,
    received,
    send(message: unknown) {
      const body = Buffer.from(JSON.stringify(message), "utf8");
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length, 0);
      child.stdin.write(Buffer.concat([header, body]));
    }
  };
}

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the condition.");
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

describe("BrowserBridge with the native host", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  it("relays a page snapshot between Mauz and the extension", async () => {
    const pipePath = testPipePath();
    const bridge = new BrowserBridge(pipePath, TOKEN);
    await bridge.start();
    cleanups.push(() => bridge.stop());
    const host = startHost(pipePath);
    cleanups.push(() => host.child.kill());

    host.send({ type: "hello", browser: "Microsoft Edge", version: "0.1.0" });
    await waitFor(() => bridge.connectedBrowsers().includes("Microsoft Edge"));

    const pending = bridge.readPage("msedge.exe", ["*bank*"]);
    await waitFor(() => host.received.length > 0);
    const request = host.received[0] as { type: string; id: number; blockedSites: string[] };

    expect(request).toMatchObject({ type: "snapshot", blockedSites: ["*bank*"] });
    host.send({
      type: "snapshot-result",
      id: request.id,
      result: {
        page: {
          browser: "Microsoft Edge",
          url: "https://shop.example.com/headphones",
          title: "Headphones",
          product: { name: "WH-1000XM5", price: "328", priceCurrency: "USD" }
        }
      }
    });

    await expect(pending).resolves.toEqual({
      page: {
        browser: "Microsoft Edge",
        url: "https://shop.example.com/headphones",
        title: "Headphones",
        product: { name: "WH-1000XM5", price: "328", priceCurrency: "USD" }
      }
    });
  });

  it("ignores a host that does not know the shared secret", async () => {
    const pipePath = testPipePath();
    const bridge = new BrowserBridge(pipePath, TOKEN);
    await bridge.start();
    cleanups.push(() => bridge.stop());
    const impostor = startHost(pipePath, "b".repeat(64));
    cleanups.push(() => impostor.child.kill());

    impostor.send({ type: "hello", browser: "Microsoft Edge", version: "0.1.0" });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(bridge.connectedBrowsers()).toEqual([]);
    await expect(bridge.readPage("msedge.exe", [])).resolves.toBeUndefined();
    // The impostor never got a request to forward to its extension.
    expect(impostor.received).toEqual([]);
  });

  it("skips browsers without a connected extension", async () => {
    const bridge = new BrowserBridge(testPipePath(), TOKEN);
    await bridge.start();
    cleanups.push(() => bridge.stop());

    await expect(bridge.readPage("chrome.exe", [])).resolves.toBeUndefined();
    await expect(bridge.readPage("notepad.exe", [])).resolves.toBeUndefined();
  });
});

describe("parseSnapshotResult", () => {
  it("re-checks the page against the never-capture list", () => {
    expect(
      parseSnapshotResult({ page: { browser: "Google Chrome", url: "https://www.paypal.com/myaccount" } }, [
        "paypal.com"
      ])
    ).toEqual({ blockedHost: "www.paypal.com" });
  });

  it("passes through a site the extension refused", () => {
    expect(parseSnapshotResult({ blockedHost: "online.examplebank.com" }, [])).toEqual({
      blockedHost: "online.examplebank.com"
    });
  });

  it("rejects malformed or non-web pages", () => {
    expect(parseSnapshotResult({ error: "no-tab" }, [])).toBeUndefined();
    expect(
      parseSnapshotResult({ page: { browser: "Google Chrome", url: "file:///C:/secret.txt" } }, [])
    ).toBe(undefined);
    expect(parseSnapshotResult({ page: { url: "https://example.com" } }, [])).toBeUndefined();
  });
});

describe("native host registration", () => {
  it("writes a launcher and manifest and registers them for Chrome and Edge", async () => {
    const files = new Map<string, string>();
    const runReg = vi.fn(async (_args: string[]) => {});

    await registerNativeHost({
      platform: "win32",
      hostScriptPath: "C:\\Mauz\\browser-extension\\native-host\\host.cjs",
      installDir: "C:\\Users\\me\\AppData\\Roaming\\MauzAI\\browser-host",
      execPath: "C:\\Mauz\\electron.exe",
      pipePath: "\\\\.\\pipe\\mauz-browser-me",
      token: TOKEN,
      writeTextFile: async (path, contents) => {
        files.set(path, contents);
      },
      runReg
    });

    const manifestPath = [...files.keys()].find((path) => path.endsWith("ai.mauz.browser.json"))!;
    expect(JSON.parse(files.get(manifestPath)!)).toMatchObject({
      name: "ai.mauz.browser",
      type: "stdio",
      allowed_origins: [`chrome-extension://${BROWSER_EXTENSION_ID}/`]
    });
    expect(runReg.mock.calls.map(([args]) => args[1])).toEqual([
      "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\ai.mauz.browser",
      "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\ai.mauz.browser"
    ]);
  });

  it("escapes percent signs in the Windows launcher", () => {
    expect(
      buildWindowsLauncher({
        execPath: "C:\\100%\\electron.exe",
        hostScriptPath: "C:\\h.cjs",
        pipePath: "p",
        token: TOKEN
      })
    ).toContain('"C:\\100%%\\electron.exe" "C:\\h.cjs" %*');
  });

  it("allows only the Mauz extension, whose ID comes from the manifest key", async () => {
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const manifest = JSON.parse(
      readFileSync(resolve(__dirname, "../../../browser-extension/extension/manifest.json"), "utf8")
    ) as { key: string };
    const id = createHash("sha256")
      .update(Buffer.from(manifest.key, "base64"))
      .digest("hex")
      .slice(0, 32)
      .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)));

    expect(id).toBe(BROWSER_EXTENSION_ID);
    expect(buildHostManifest("x")).toContain(`chrome-extension://${id}/`);
  });
});

describe("chooseSnapshot", () => {
  const page = (url: string) => ({ page: { browser: "Google Chrome", url } });

  it("blocks when any profile shows a never-capture site", () => {
    expect(
      chooseSnapshot([
        { result: page("https://shop.example.com"), focused: true },
        { result: { blockedHost: "online.examplebank.com" }, focused: false }
      ])
    ).toEqual({ blockedHost: "online.examplebank.com" });
  });

  it("uses the focused profile, or the only one", () => {
    expect(
      chooseSnapshot([
        { result: page("https://a.example.com"), focused: false },
        { result: page("https://b.example.com"), focused: true }
      ])
    ).toEqual(page("https://b.example.com"));
    expect(chooseSnapshot([{ result: page("https://a.example.com"), focused: false }])).toEqual(
      page("https://a.example.com")
    );
  });

  it("does not guess between unfocused profiles", () => {
    expect(
      chooseSnapshot([
        { result: page("https://a.example.com"), focused: false },
        { result: page("https://b.example.com"), focused: false }
      ])
    ).toBeUndefined();
  });
});
