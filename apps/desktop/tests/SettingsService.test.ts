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
  it("clears a saved API key without treating the runtime process env as configured", async () => {
    const service = createSettingsService({
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiApiKey: "sk-saved"
      })
    });

    await expect(service.get()).resolves.toMatchObject({
      apiKeyConfigured: true
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-saved"
    });

    await expect(service.update({ openAiApiKey: null })).resolves.toMatchObject({
      apiKeyConfigured: false
    });
    await expect(service.getRuntime()).resolves.not.toHaveProperty("openAiApiKey");
  });

  it("falls back to the startup environment API key after clearing a saved key", async () => {
    const service = createSettingsService({
      environmentApiKey: "sk-env",
      settingsJson: JSON.stringify({
        ...DEFAULT_SETTINGS,
        openAiApiKey: "sk-saved"
      })
    });

    await expect(service.update({ openAiApiKey: null })).resolves.toMatchObject({
      apiKeyConfigured: true
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiApiKey: "sk-env"
    });
  });

  it("persists the selected OpenAI auth mode", async () => {
    const service = createSettingsService({
      settingsJson: JSON.stringify(DEFAULT_SETTINGS)
    });

    await expect(service.update({ openAiAuthMode: "codex" })).resolves.toMatchObject({
      openAiAuthMode: "codex"
    });
    await expect(service.getRuntime()).resolves.toMatchObject({
      openAiAuthMode: "codex"
    });
  });
});

function createSettingsService({
  environmentApiKey = null,
  settingsJson
}: {
  environmentApiKey?: string | null | undefined;
  settingsJson: string;
}): SettingsService {
  const writes: string[] = [];

  return new SettingsService({
    settingsPath: join(tmpdir(), `mauz-settings-${randomUUID()}.json`),
    environmentApiKey,
    readTextFile: async () => writes.at(-1) ?? settingsJson,
    writeTextFile: async (_path, value) => {
      writes.push(value);
    },
    ensureDirectory: async () => {}
  });
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
