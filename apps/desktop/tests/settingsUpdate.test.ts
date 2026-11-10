import { describe, expect, it } from "vitest";
import type { MauzSettings } from "@mauzai/shared";
import { buildSettingsUpdate, EMPTY_KEY_DRAFTS } from "../src/renderer/src/lib/settingsUpdate";

const SETTINGS: MauzSettings = {
  nativeShakeEnabled: true,
  devHotkeyEnabled: false,
  shakeSensitivity: "strict",
  openAiAuthDisconnected: false,
  openAiCredentialSource: "saved",
  askModel: "gpt-5.4-mini",
  captureBlockedApps: [],
  captureBlockedSites: [],
  apiKeyConfigured: true,
  taskAgent: "codex",
  taskFolder: "  C:\\work  ",
  taskAgentFolders: {},
  aiProvider: "anthropic",
  anthropicKeyConfigured: false
};

describe("buildSettingsUpdate", () => {
  it("sends the draft fields and no key fields when no key was touched", () => {
    expect(
      buildSettingsUpdate(SETTINGS, EMPTY_KEY_DRAFTS, { apps: " 1Password.exe \r\n\n", sites: "bank.com" })
    ).toEqual({
      nativeShakeEnabled: true,
      devHotkeyEnabled: false,
      shakeSensitivity: "strict",
      openAiAuthDisconnected: false,
      askModel: "gpt-5.4-mini",
      captureBlockedApps: ["1Password.exe"],
      captureBlockedSites: ["bank.com"],
      taskAgent: "codex",
      taskFolder: "C:\\work",
      aiProvider: "anthropic"
    });
  });

  it("sends a typed key trimmed, and a clear request", () => {
    const update = buildSettingsUpdate(
      SETTINGS,
      { anthropic: { value: "  sk-ant-new  ", clear: false }, openai: { value: "   ", clear: true } },
      { apps: "", sites: "" }
    );

    expect(update.anthropicApiKey).toBe("sk-ant-new");
    expect(update).not.toHaveProperty("clearAnthropicApiKey");
    expect(update).not.toHaveProperty("openAiApiKey");
    expect(update.clearOpenAiApiKey).toBe(true);
  });
});
