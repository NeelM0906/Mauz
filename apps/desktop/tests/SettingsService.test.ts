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

  it("keeps OpenAI auth mode on the API key path", async () => {
    const { service } = createSettingsService({
      settingsJson: JSON.stringify(DEFAULT_SETTINGS)
    });

    await expect(service.update({ openAiAuthMode: "api-key" })).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
  });

  it("migrates unsupported account auth mode settings to the API key path", async () => {
    const accountSettings = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiAuthMode: "account-login"
      })
    });
    const legacySettings = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiAuthMode: "openai-auth"
      })
    });

    await expect(accountSettings.service.get()).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
    await expect(legacySettings.service.get()).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
    expect(accountSettings.writes.at(-1)).toContain('"openAiAuthMode": "api-key"');
    expect(legacySettings.writes.at(-1)).toContain('"openAiAuthMode": "api-key"');
  });
});

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
  openAiAuthMode: "api-key",
  openAiAuthDisconnected: false,
  askModel: "gpt-5.4-mini",
  chatTitleModel: "gpt-5.4-nano",
  realtimeModel: "gpt-realtime-2",
  realtimeVoice: "marin",
  realtimeReasoningEffort: "low",
  includeFullScreenshot: false
} as const;
