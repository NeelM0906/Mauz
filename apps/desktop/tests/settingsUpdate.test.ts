import { describe, expect, it } from "vitest";
import type { MauzSettings } from "@mauzai/shared";
import { MAX_CAPTURE_BLOCKED_APPS, MAX_CAPTURE_BLOCKED_ENTRY_CHARS } from "@mauzai/shared";
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

  it("sends both typed keys, and an Anthropic clear request", () => {
    const update = buildSettingsUpdate(
      SETTINGS,
      { anthropic: { value: "sk-ant-a", clear: true }, openai: { value: "sk-o", clear: false } },
      { apps: "", sites: "" }
    );

    expect(update.anthropicApiKey).toBe("sk-ant-a");
    expect(update.clearAnthropicApiKey).toBe(true);
    expect(update.openAiApiKey).toBe("sk-o");
    expect(update).not.toHaveProperty("clearOpenAiApiKey");
  });

  it("passes openAiAuthDisconnected through", () => {
    const update = buildSettingsUpdate({ ...SETTINGS, openAiAuthDisconnected: true }, EMPTY_KEY_DRAFTS, {
      apps: "",
      sites: ""
    });

    expect(update.openAiAuthDisconnected).toBe(true);
  });

  it("keeps the block lists within the schema limits", () => {
    const longEntry = "x".repeat(MAX_CAPTURE_BLOCKED_ENTRY_CHARS + 10);
    const manyApps = Array.from({ length: MAX_CAPTURE_BLOCKED_APPS + 5 }, (_, index) => `app${index}.exe`);
    const update = buildSettingsUpdate(SETTINGS, EMPTY_KEY_DRAFTS, {
      apps: manyApps.join("\n"),
      sites: longEntry
    });

    expect(update.captureBlockedApps).toEqual(manyApps.slice(0, MAX_CAPTURE_BLOCKED_APPS));
    expect(update.captureBlockedSites).toEqual(["x".repeat(MAX_CAPTURE_BLOCKED_ENTRY_CHARS)]);
  });
});
