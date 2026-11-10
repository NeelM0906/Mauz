import type { MauzSettings, MauzSettingsUpdate } from "@mauzai/shared";
import { MAX_CAPTURE_BLOCKED_APPS, MAX_CAPTURE_BLOCKED_ENTRY_CHARS } from "@mauzai/shared";

export type ApiKeyId = "anthropic" | "openai";
/** A key typed in Settings, or a request to clear the saved key. Sent on Save. */
export type ApiKeyDraft = { value: string; clear: boolean };
export type ApiKeyDrafts = Record<ApiKeyId, ApiKeyDraft>;
/** The "Never capture" lists, edited as free text so a new line is not normalized away. */
export type BlockedListText = { apps: string; sites: string };

export const EMPTY_KEY_DRAFTS: ApiKeyDrafts = {
  anthropic: { value: "", clear: false },
  openai: { value: "", clear: false }
};

export function formatAppList(apps: readonly string[] | undefined): string {
  return apps === undefined ? "" : apps.join("\n");
}

function parseAppList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().slice(0, MAX_CAPTURE_BLOCKED_ENTRY_CHARS))
    .filter((line) => line.length > 0)
    .slice(0, MAX_CAPTURE_BLOCKED_APPS);
}

/** The payload that Save sends. Key fields are sent only when the user typed or cleared a key. */
export function buildSettingsUpdate(
  draft: MauzSettings,
  keys: ApiKeyDrafts,
  blocked: BlockedListText
): MauzSettingsUpdate {
  const update: MauzSettingsUpdate = {
    nativeShakeEnabled: draft.nativeShakeEnabled,
    devHotkeyEnabled: draft.devHotkeyEnabled,
    shakeSensitivity: draft.shakeSensitivity,
    openAiAuthDisconnected: draft.openAiAuthDisconnected,
    askModel: draft.askModel,
    captureBlockedApps: parseAppList(blocked.apps),
    captureBlockedSites: parseAppList(blocked.sites),
    taskAgent: draft.taskAgent,
    taskFolder: draft.taskFolder.trim(),
    aiProvider: draft.aiProvider
  };
  const openAiKey = keys.openai.value.trim();
  const anthropicKey = keys.anthropic.value.trim();

  if (openAiKey.length > 0) {
    update.openAiApiKey = openAiKey;
  }

  if (keys.openai.clear) {
    update.clearOpenAiApiKey = true;
  }

  if (anthropicKey.length > 0) {
    update.anthropicApiKey = anthropicKey;
  }

  if (keys.anthropic.clear) {
    update.clearAnthropicApiKey = true;
  }

  return update;
}
