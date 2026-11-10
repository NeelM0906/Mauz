import { describe, expect, it } from "vitest";
import { MauzSettingsSchema } from "@mauzai/shared";

function buildSettingsFixture() {
  return {
    nativeShakeEnabled: true,
    devHotkeyEnabled: false,
    shakeSensitivity: "normal" as const,
    openAiCredentialSource: "none" as const,
    askModel: "gpt-5.4-mini",
    captureBlockedApps: [],
    captureBlockedSites: [],
    apiKeyConfigured: false,
    aiProvider: "auto" as const,
    anthropicKeyConfigured: false,
    taskAgent: "auto" as const,
    taskFolder: "",
    taskAgentFolders: {}
  };
}

describe("backend schema additions", () => {
  it("parses Task agent settings", () => {
    const settings = MauzSettingsSchema.parse({
      ...buildSettingsFixture(),
      taskAgent: "claude-code",
      taskFolder: "C:/work",
      taskAgentFolders: { "claude-code": "C:/work/mauz" }
    });

    expect(settings.taskAgent).toBe("claude-code");
    expect(settings.taskAgentFolders).toEqual({ "claude-code": "C:/work/mauz" });
  });
});
