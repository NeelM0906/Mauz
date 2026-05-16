import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app } from "electron";
import {
  MauzSettingsSchema,
  MauzSettingsUpdateSchema,
  readBooleanEnv,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";

type SettingsServiceOptions = {
  settingsPath?: string;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, value: string) => Promise<void>;
  ensureDirectory?: (path: string) => Promise<void>;
  defaults?: StoredMauzSettings;
  environmentApiKey?: string | null | undefined;
};

const SETTINGS_FILE_NAME = "mauz-settings.json";
const DEFAULT_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_CHAT_TITLE_MODEL = "gpt-5.4-nano";
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_REALTIME_REASONING_EFFORT = "low";

type StoredMauzSettings = Omit<MauzSettings, "apiKeyConfigured">;

export type MauzRuntimeSettings = StoredMauzSettings & {
  openAiApiKey?: string | undefined;
};

export class SettingsService {
  private readonly settingsPath: string;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly writeTextFile: (path: string, value: string) => Promise<void>;
  private readonly ensureDirectory: (path: string) => Promise<void>;
  private readonly defaults: StoredMauzSettings;
  private readonly environmentApiKey: string | undefined;
  private cachedSettings: StoredMauzSettings | null = null;

  constructor(options: SettingsServiceOptions = {}) {
    const rawEnvironmentApiKey =
      "environmentApiKey" in options ? options.environmentApiKey : process.env.OPENAI_API_KEY;

    this.settingsPath = options.settingsPath ?? join(app.getPath("userData"), SETTINGS_FILE_NAME);
    this.readTextFile = options.readTextFile ?? readFileUtf8;
    this.writeTextFile = options.writeTextFile ?? writeFileUtf8;
    this.ensureDirectory = options.ensureDirectory ?? ensureDirectoryExists;
    this.defaults = options.defaults ?? getDefaultSettings();
    this.environmentApiKey = normalizeApiKey(rawEnvironmentApiKey);
  }

  async get(): Promise<MauzSettings> {
    return toPublicSettings(await this.getStored(), this.environmentApiKey);
  }

  async getRuntime(): Promise<MauzRuntimeSettings> {
    const stored = await this.getStored();

    return {
      ...stored,
      ...(this.environmentApiKey ? { openAiApiKey: this.environmentApiKey } : {})
    };
  }

  async update(update: MauzSettingsUpdate): Promise<MauzSettings> {
    const parsedUpdate = MauzSettingsUpdateSchema.parse(update);
    const currentSettings = await this.getStored();
    const nextSettings: StoredMauzSettings = { ...currentSettings };

    applyDefinedSetting(nextSettings, "nativeShakeEnabled", parsedUpdate.nativeShakeEnabled);
    applyDefinedSetting(nextSettings, "devHotkeyEnabled", parsedUpdate.devHotkeyEnabled);
    applyDefinedSetting(nextSettings, "shakeSensitivity", parsedUpdate.shakeSensitivity);
    applyDefinedSetting(nextSettings, "openAiAuthMode", parsedUpdate.openAiAuthMode);
    applyDefinedSetting(nextSettings, "askModel", parsedUpdate.askModel);
    applyDefinedSetting(nextSettings, "chatTitleModel", parsedUpdate.chatTitleModel);
    applyDefinedSetting(nextSettings, "realtimeModel", parsedUpdate.realtimeModel);
    applyDefinedSetting(nextSettings, "realtimeVoice", parsedUpdate.realtimeVoice);
    applyDefinedSetting(nextSettings, "realtimeReasoningEffort", parsedUpdate.realtimeReasoningEffort);
    applyDefinedSetting(nextSettings, "includeFullScreenshot", parsedUpdate.includeFullScreenshot);

    await this.ensureDirectory(dirname(this.settingsPath));
    await this.writeTextFile(this.settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
    this.cachedSettings = nextSettings;

    return toPublicSettings(nextSettings, this.environmentApiKey);
  }

  private async getStored(): Promise<StoredMauzSettings> {
    if (this.cachedSettings !== null) {
      return this.cachedSettings;
    }

    try {
      const rawSettings = await this.readTextFile(this.settingsPath);
      const parsed = JSON.parse(rawSettings) as unknown;
      const parsedSettings = parseStoredSettings(parsed);

      if (parsedSettings !== null) {
        if (shouldSanitizeStoredSettings(parsed)) {
          await this.sanitizeStoredSettings(parsedSettings);
        }

        this.cachedSettings = parsedSettings;
        return parsedSettings;
      }
    } catch {
      // Missing or malformed settings should never prevent Mauz from starting.
    }

    this.cachedSettings = this.defaults;
    return this.defaults;
  }

  private async sanitizeStoredSettings(settings: StoredMauzSettings): Promise<void> {
    try {
      await this.ensureDirectory(dirname(this.settingsPath));
      await this.writeTextFile(this.settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
    } catch {
      // Sanitization is best effort; startup should still continue with in-memory safe settings.
    }
  }
}

function applyDefinedSetting<Key extends keyof StoredMauzSettings>(
  settings: StoredMauzSettings,
  key: Key,
  value: StoredMauzSettings[Key] | undefined
): void {
  if (value !== undefined) {
    settings[key] = value;
  }
}

function getDefaultSettings(): StoredMauzSettings {
  return {
    nativeShakeEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_NATIVE_INPUT, true),
    devHotkeyEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_DEV_HOTKEY, true),
    shakeSensitivity: "normal",
    openAiAuthMode: "api-key",
    askModel: process.env.OPENAI_ASK_MODEL?.trim() || DEFAULT_ASK_MODEL,
    chatTitleModel: process.env.OPENAI_CHAT_TITLE_MODEL?.trim() || DEFAULT_CHAT_TITLE_MODEL,
    realtimeModel: process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL,
    realtimeVoice: process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE,
    realtimeReasoningEffort:
      process.env.OPENAI_REALTIME_REASONING_EFFORT === "medium" ||
      process.env.OPENAI_REALTIME_REASONING_EFFORT === "high"
        ? process.env.OPENAI_REALTIME_REASONING_EFFORT
        : DEFAULT_REALTIME_REASONING_EFFORT,
    includeFullScreenshot: readBooleanEnv(process.env.OPENAI_INCLUDE_FULL_SCREENSHOT, false)
  };
}

function parseStoredSettings(parsed: unknown): StoredMauzSettings | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const candidate = {
    ...getDefaultSettings(),
    ...parsed,
    apiKeyConfigured: false
  };
  const publicSettings = MauzSettingsSchema.safeParse(candidate);

  if (!publicSettings.success) {
    return null;
  }

  return {
    nativeShakeEnabled: publicSettings.data.nativeShakeEnabled,
    devHotkeyEnabled: publicSettings.data.devHotkeyEnabled,
    shakeSensitivity: publicSettings.data.shakeSensitivity,
    openAiAuthMode: publicSettings.data.openAiAuthMode,
    askModel: publicSettings.data.askModel,
    chatTitleModel: publicSettings.data.chatTitleModel,
    realtimeModel: publicSettings.data.realtimeModel,
    realtimeVoice: publicSettings.data.realtimeVoice,
    realtimeReasoningEffort: publicSettings.data.realtimeReasoningEffort,
    includeFullScreenshot: publicSettings.data.includeFullScreenshot
  };
}

function shouldSanitizeStoredSettings(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  return "openAiApiKey" in parsed || ("openAiAuthMode" in parsed && parsed.openAiAuthMode !== "api-key");
}

function toPublicSettings(settings: StoredMauzSettings, environmentApiKey: string | undefined): MauzSettings {
  return {
    nativeShakeEnabled: settings.nativeShakeEnabled,
    devHotkeyEnabled: settings.devHotkeyEnabled,
    shakeSensitivity: settings.shakeSensitivity,
    openAiAuthMode: settings.openAiAuthMode,
    askModel: settings.askModel,
    chatTitleModel: settings.chatTitleModel,
    realtimeModel: settings.realtimeModel,
    realtimeVoice: settings.realtimeVoice,
    realtimeReasoningEffort: settings.realtimeReasoningEffort,
    includeFullScreenshot: settings.includeFullScreenshot,
    apiKeyConfigured: environmentApiKey !== undefined
  };
}

function normalizeApiKey(value: string | null | undefined): string | undefined {
  const trimmedValue = value?.trim() ?? "";

  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

async function readFileUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

async function writeFileUtf8(path: string, value: string): Promise<void> {
  await writeFile(path, value, "utf8");
}

async function ensureDirectoryExists(path: string): Promise<void> {
  await mkdir(path, {
    recursive: true
  });
}
