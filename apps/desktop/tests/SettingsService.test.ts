import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

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

import { SettingsService } from "../src/main/settings/SettingsService";

type TestSecretCodec = {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

describe("SettingsService", () => {
  it("defaults Task agent settings", async () => {
    const service = createService();
    const runtime = await service.getRuntime();
    expect(runtime.taskAgent).toBe("auto");
    expect(runtime.taskFolder).toBe("");
    expect(runtime.taskAgentFolders).toEqual({});
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

  it("stores and clears the Anthropic key encrypted", async () => {
    const { service, writes } = createSettingsService({
      settingsJson: JSON.stringify(DEFAULT_SETTINGS),
      secretCodec: createTestSecretCodec()
    });

    await service.update({ anthropicApiKey: " sk-ant-new " });
    expect(JSON.parse(writes.at(-1)!).encryptedAnthropicApiKey).toBe(
      createTestSecretCodec().encrypt("sk-ant-new")
    );
    await expect(service.getRuntime()).resolves.toMatchObject({ anthropicApiKey: "sk-ant-new" });

    await service.update({ clearAnthropicApiKey: true });
    expect(writes.at(-1)).not.toContain("encryptedAnthropicApiKey");
  });

  it("refuses to save a key when secure storage is unavailable", async () => {
    const { service } = createSettingsService({ settingsJson: JSON.stringify(DEFAULT_SETTINGS) });

    await expect(service.update({ openAiApiKey: "sk-new" })).rejects.toThrow(
      "Mauz could not save the OpenAI API key securely on this computer."
    );
    await expect(service.update({ anthropicApiKey: "sk-ant-new" })).rejects.toThrow(
      "Mauz could not save the Anthropic API key securely on this computer."
    );
  });

  it("loads an old file with openAiAuthDisconnected and uses the environment key", async () => {
    const { service } = createSettingsService({
      environmentApiKey: "sk-env",
      settingsJson: JSON.stringify({ ...DEFAULT_SETTINGS, openAiAuthDisconnected: true })
    });

    const settings = await service.get();
    expect(settings).toMatchObject({ apiKeyConfigured: true, openAiCredentialSource: "environment" });
    expect(settings).not.toHaveProperty("openAiAuthDisconnected");
    await expect(service.getRuntime()).resolves.toMatchObject({ openAiApiKey: "sk-env" });
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
    files.set(SHARED_SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS));

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

  it("loads an old settings file that still has installId and a legacy backendPreset", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        askModel: "gpt-5.5",
        installId: "aabbccdd-1122-3344-5566-778899aabbcc",
        backendPreset: "not-a-valid-preset"
      })
    });
    const runtime = await service.getRuntime();
    expect(runtime.askModel).toBe("gpt-5.5");
    expect(runtime).not.toHaveProperty("installId");
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
  askModel: "gpt-5.4-mini",
  captureBlockedApps: [],
  captureBlockedSites: []
} as const;
