import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => tmpdir()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

import { createMauzApiServer } from "@mauzai/api/server";
import { SettingsService } from "../src/main/settings/SettingsService";

type TestSecretCodec = {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

describe("SettingsService", () => {
  it("defaults Task agent settings and generates a stable installId", async () => {
    const service = createService();
    const runtime = await service.getRuntime();
    expect(runtime.taskAgent).toBe("auto");
    expect(runtime.taskFolder).toBe("");
    expect(runtime.taskAgentFolders).toEqual({});
    expect(runtime.installId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("defaults the never-capture list to common password managers", async () => {
    const settings = await createService().get();

    expect(settings.captureBlockedApps).toEqual(
      expect.arrayContaining(["1Password.exe", "Bitwarden.exe", "KeePassXC.exe", "com.1password.1password"])
    );
  });

  it("ignores the removed full-screenshot setting in stored files", async () => {
    const { captureBlockedApps: _captureBlockedApps, ...stored } = DEFAULT_SETTINGS;
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({ ...stored, includeFullScreenshot: true })
    });

    const settings = await service.get();

    expect(settings).not.toHaveProperty("includeFullScreenshot");
    expect(settings.captureBlockedApps).toContain("1Password.exe");
  });

  it("saves the never-capture list trimmed and without duplicates", async () => {
    const settings = await createService().update({
      captureBlockedApps: [" Signal.exe ", "signal.exe", "com.agilebits.onepassword7"]
    });

    expect(settings.captureBlockedApps).toEqual(["Signal.exe", "com.agilebits.onepassword7"]);
  });

  it("persists installId across loads once written", async () => {
    const files = new Map<string, string>();
    const service = createServiceWithFiles(files);
    const first = (await service.getRuntime()).installId;
    await service.update({ askModel: "gpt-5.4-mini" }); // forces a write
    const service2 = createServiceWithFiles(files);
    expect((await service2.getRuntime()).installId).toBe(first);
  });

  it("updates the task agent, default folder, and last folder per agent", async () => {
    const service = createService();
    const settings = await service.update({
      taskAgent: "claude-code",
      taskFolder: "C:/work",
      taskAgentFolders: { "claude-code": "C:/work/mauz" }
    });
    expect(settings.taskAgent).toBe("claude-code");
    expect(settings.taskFolder).toBe("C:/work");
    expect(settings.taskAgentFolders).toEqual({ "claude-code": "C:/work/mauz" });
  });

  it("keeps Hermes as the task agent for someone who used Agentic mode", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        assistantMode: "agentic",
        backendBaseUrl: "http://localhost:8642/v1",
        agentMode: "approve"
      })
    });
    const settings = await service.get();
    expect(settings.taskAgent).toBe("hermes");
    expect(settings.nativeShakeEnabled).toBe(DEFAULT_SETTINGS.nativeShakeEnabled);
  });

  it("keeps Hermes as the task agent for a legacy hermes backendPreset", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({ ...DEFAULT_SETTINGS, backendPreset: "hermes" })
    });
    const settings = await service.get();
    expect(settings.taskAgent).toBe("hermes");
  });

  it("uses the automatic task agent for someone who used Simple mode", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({ ...DEFAULT_SETTINGS, assistantMode: "simple" })
    });
    const settings = await service.get();
    expect(settings.taskAgent).toBe("auto");
  });

  it("falls back to defaults for an invalid stored task agent without losing other settings", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        taskAgent: "not-an-agent",
        taskAgentFolders: "not-a-record"
      })
    });
    const settings = await service.get();
    expect(settings.taskAgent).toBe("auto");
    expect(settings.taskAgentFolders).toEqual({});
    expect(settings.nativeShakeEnabled).toBe(DEFAULT_SETTINGS.nativeShakeEnabled);
  });

  it("rewrites the file without the gateway-era fields", async () => {
    const { service, writes } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        backendPreset: "hermes",
        assistantMode: "agentic",
        backendBaseUrl: "",
        agentMode: "approve"
      })
    });
    await service.get();
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.at(-1)).toContain('"taskAgent": "hermes"');
    expect(writes.at(-1)).not.toContain("backendPreset");
    expect(writes.at(-1)).not.toContain("assistantMode");
    expect(writes.at(-1)).not.toContain("agentMode");
  });

  it("removes legacy plaintext API keys from stored settings", async () => {
    const { service, writes } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiApiKey: "sk-saved"
      })
    });

    await expect(service.get()).resolves.toMatchObject({
      apiKeyConfigured: false
    });
    await expect(service.getRuntime()).resolves.not.toHaveProperty("openAiApiKey");
    expect(writes.at(-1)).not.toContain("openAiApiKey");
  });

  it("uses the startup environment API key at runtime without persisting it", async () => {
    const { service, writes } = createSettingsService({
      environmentApiKey: "sk-env",
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiApiKey: "sk-saved"
      })
    });

    await expect(service.update({ askModel: "gpt-5.4" })).resolves.toMatchObject({
      apiKeyConfigured: true,
      openAiCredentialSource: "environment"
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-env"
    });
    expect(writes.at(-1)).not.toContain("openAiApiKey");
  });

  it("lets a saved encrypted API key replace the launch environment key at runtime", async () => {
    const secretCodec = createTestSecretCodec();
    const { service } = createSettingsService({
      environmentApiKey: "sk-env",
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        encryptedOpenAiApiKey: secretCodec.encrypt("sk-saved")
      }),
      secretCodec
    });

    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-saved"
    });
    await expect(service.get()).resolves.toMatchObject({
      openAiCredentialSource: "saved"
    });
  });

  it("stores updated API keys encrypted and uses them at runtime", async () => {
    const { service, writes } = createSettingsService({
      settingsJson: JSON.stringify(DEFAULT_SETTINGS),
      secretCodec: createTestSecretCodec()
    });

    await expect(service.update({ openAiApiKey: " sk-new " })).resolves.toMatchObject({
      apiKeyConfigured: true
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-new"
    });
    expect(writes.at(-1)).toContain("encryptedOpenAiApiKey");
    expect(writes.at(-1)).not.toContain("sk-new");
  });

  it("can disconnect and reconnect launch environment credentials at runtime", async () => {
    const { service } = createSettingsService({
      environmentApiKey: "sk-env",
      settingsJson: JSON.stringify(DEFAULT_SETTINGS)
    });

    await expect(service.get()).resolves.toMatchObject({
      apiKeyConfigured: true,
      openAiCredentialSource: "environment"
    });
    await expect(service.update({ openAiAuthDisconnected: true })).resolves.toMatchObject({
      apiKeyConfigured: false,
      openAiAuthDisconnected: true,
      openAiCredentialSource: "none"
    });
    await expect(service.getRuntime()).resolves.not.toHaveProperty("openAiApiKey");
    await expect(service.update({ openAiAuthDisconnected: false })).resolves.toMatchObject({
      apiKeyConfigured: true,
      openAiAuthDisconnected: false,
      openAiCredentialSource: "environment"
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-env"
    });
  });

  it("re-enables OpenAI auth when saving a replacement API key", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiAuthDisconnected: true
      }),
      secretCodec: createTestSecretCodec()
    });

    await expect(service.update({ openAiApiKey: "sk-relogin" })).resolves.toMatchObject({
      apiKeyConfigured: true,
      openAiAuthDisconnected: false,
      openAiCredentialSource: "saved"
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-relogin"
    });
  });

  it("clears a saved encrypted API key", async () => {
    const secretCodec = createTestSecretCodec();
    const { service, writes } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        encryptedOpenAiApiKey: secretCodec.encrypt("sk-saved")
      }),
      secretCodec
    });

    await expect(service.get()).resolves.toMatchObject({
      apiKeyConfigured: true
    });
    await expect(service.update({ clearOpenAiApiKey: true })).resolves.toMatchObject({
      apiKeyConfigured: false
    });
    expect(writes.at(-1)).not.toContain("encryptedOpenAiApiKey");
  });

  it("serializes concurrent updates so neither change is lost", async () => {
    const files = new Map<string, string>();
    files.set(
      SHARED_SETTINGS_PATH,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        installId: "aabbccdd-1122-3344-5566-778899aabbcc"
      })
    );

    const service = createServiceWithFiles(files);

    await Promise.all([
      service.update({ askModel: "gpt-concurrent-a" }),
      service.update({ taskAgent: "codex" })
    ]);

    const service2 = createServiceWithFiles(files);
    const runtime = await service2.getRuntime();
    expect(runtime.askModel).toBe("gpt-concurrent-a");
    expect(runtime.taskAgent).toBe("codex");
  });

  it("preserves installId from a settings file with malformed JSON", async () => {
    const knownId = "aabbccdd-1122-3344-5566-778899aabbcc";
    const { service } = createSettingsService({
      settingsJson: `not valid json but "installId": "${knownId}" is in here`
    });
    const runtime = await service.getRuntime();
    expect(runtime.installId).toBe(knownId);
  });

  it("preserves installId when stored settings contain a legacy backendPreset field", async () => {
    const knownId = "aabbccdd-1122-3344-5566-778899aabbcc";
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        installId: knownId,
        backendPreset: "not-a-valid-preset"
      })
    });
    const runtime = await service.getRuntime();
    expect(runtime.installId).toBe(knownId);
  });

  it("loads settings saved by older versions and drops removed fields", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        askModel: "gpt-5.5",
        openAiAuthMode: "account-login",
        chatTitleModel: "gpt-5.4-nano",
        realtimeVoice: "marin",
        aiFallbackProvider: "codex",
        talkEngine: "realtime"
      })
    });
    const settings = await service.get();

    expect(settings.askModel).toBe("gpt-5.5");
    expect(settings).not.toHaveProperty("openAiAuthMode");
    expect(settings).not.toHaveProperty("talkEngine");
    expect(settings).not.toHaveProperty("aiFallbackProvider");
  });
});

// Defect from docs/reafactor-audit.md. It fails today; refactor row 1 fixes it and removes `.skip`.
describe("known defects", () => {
  const originalCwd = process.cwd();
  const originalKey = process.env.OPENAI_API_KEY;
  const folder = join(tmpdir(), `mauz-dotenv-test-${randomUUID()}`);

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(folder, { recursive: true, force: true });
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it.skip("sees a key that is only in .env, in the order bootstrap() starts services", async () => {
    mkdirSync(folder);
    writeFileSync(join(folder, ".env"), "OPENAI_API_KEY=sk-dotenv\n");
    process.chdir(folder);
    delete process.env.OPENAI_API_KEY;

    // bootstrap(): SettingsService first, then launchLocalApi -> createMauzApiServer loads .env.
    const service = new SettingsService({
      settingsPath: join(folder, "settings.json"),
      readTextFile: async () => {
        throw new Error("no file");
      },
      writeTextFile: async () => {},
      renameFile: async () => {},
      ensureDirectory: async () => {}
    });
    const api = await createMauzApiServer();
    await api.close();

    expect(process.env.OPENAI_API_KEY).toBe("sk-dotenv"); // Ask uses this key.
    expect((await service.get()).openAiCredentialSource).toBe("environment"); // Settings shows "none".
    // applyRuntimeEnvironment() deletes OPENAI_API_KEY on the next save when this is missing.
    expect((await service.getRuntime()).openAiApiKey).toBe("sk-dotenv");
  });
});

const SHARED_SETTINGS_PATH = "/tmp/mauz-settings-shared-test.json";

function createService(): SettingsService {
  return new SettingsService({
    settingsPath: join(tmpdir(), `mauz-settings-${randomUUID()}.json`),
    readTextFile: async () => {
      throw new Error("no file");
    },
    writeTextFile: async () => {},
    renameFile: async () => {},
    ensureDirectory: async () => {}
  });
}

function createServiceWithFiles(files: Map<string, string>): SettingsService {
  return new SettingsService({
    settingsPath: SHARED_SETTINGS_PATH,
    readTextFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`File not found: ${path}`);
      return content;
    },
    writeTextFile: async (path, value) => {
      files.set(path, value);
    },
    renameFile: async (from, to) => {
      const content = files.get(from);
      if (content !== undefined) {
        files.delete(from);
        files.set(to, content);
      }
    },
    ensureDirectory: async () => {}
  });
}

function createSettingsService({
  environmentApiKey = null,
  settingsJson,
  secretCodec
}: {
  environmentApiKey?: string | null | undefined;
  settingsJson: string;
  secretCodec?: TestSecretCodec;
}): { service: SettingsService; writes: string[] } {
  const writes: string[] = [];

  const service = new SettingsService({
    settingsPath: join(tmpdir(), `mauz-settings-${randomUUID()}.json`),
    environmentApiKey,
    readTextFile: async () => writes.at(-1) ?? settingsJson,
    writeTextFile: async (_path, value) => {
      writes.push(value);
    },
    renameFile: async () => {
      // In tests the readTextFile already returns the latest write regardless of
      // the final path, so a no-op rename is sufficient.
    },
    ensureDirectory: async () => {},
    ...(secretCodec === undefined ? {} : { secretCodec })
  });

  return { service, writes };
}

function createTestSecretCodec(): TestSecretCodec {
  return {
    isAvailable: () => true,
    encrypt: (value: string) => Buffer.from(value, "utf8").toString("base64"),
    decrypt: (value: string) => Buffer.from(value, "base64").toString("utf8")
  };
}

const DEFAULT_SETTINGS = {
  nativeShakeEnabled: true,
  devHotkeyEnabled: true,
  shakeSensitivity: "normal",
  openAiAuthDisconnected: false,
  askModel: "gpt-5.4-mini",
  captureBlockedApps: [],
  captureBlockedSites: []
} as const;
