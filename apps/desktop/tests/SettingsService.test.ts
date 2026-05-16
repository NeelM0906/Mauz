import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => tmpdir()
  }
}));

import { SettingsService } from "../src/main/settings/SettingsService";

describe("SettingsService", () => {
  it("removes legacy saved API keys and only uses the launch environment key", async () => {
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
      apiKeyConfigured: true
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-env"
    });
    expect(writes.at(-1)).not.toContain("openAiApiKey");
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

  it("migrates old Codex and ChatGPT auth mode settings to API key", async () => {
    const codexSettings = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiAuthMode: "codex"
      })
    });
    const chatGptSettings = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiAuthMode: "chatgpt"
      })
    });

    await expect(codexSettings.service.get()).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
    await expect(chatGptSettings.service.get()).resolves.toMatchObject({
      openAiAuthMode: "api-key"
    });
    expect(codexSettings.writes.at(-1)).toContain('"openAiAuthMode": "api-key"');
    expect(chatGptSettings.writes.at(-1)).toContain('"openAiAuthMode": "api-key"');
  });
});

function createSettingsService({
  environmentApiKey = null,
  settingsJson
}: {
  environmentApiKey?: string | null | undefined;
  settingsJson: string;
}): { service: SettingsService; writes: string[] } {
  const writes: string[] = [];

  const service = new SettingsService({
    settingsPath: join(tmpdir(), `mauz-settings-${randomUUID()}.json`),
    environmentApiKey,
    readTextFile: async () => writes.at(-1) ?? settingsJson,
    writeTextFile: async (_path, value) => {
      writes.push(value);
    },
    ensureDirectory: async () => {}
  });

  return { service, writes };
}

const DEFAULT_SETTINGS = {
  nativeShakeEnabled: true,
  devHotkeyEnabled: true,
  shakeSensitivity: "normal",
  openAiAuthMode: "api-key",
  askModel: "gpt-5.4-mini",
  chatTitleModel: "gpt-5.4-nano",
  realtimeModel: "gpt-realtime-2",
  realtimeVoice: "marin",
  realtimeReasoningEffort: "low",
  includeFullScreenshot: false
} as const;
