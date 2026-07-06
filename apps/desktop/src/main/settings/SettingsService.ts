import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import {
  MauzSettingsSchema,
  MauzSettingsUpdateSchema,
  readBooleanEnv,
  type AgentMode,
  type BackendPreset,
  type MauzSettings,
  type MauzSettingsUpdate,
  type OpenAiCredentialSource
} from "@mauzai/shared";

type SettingsServiceOptions = {
  settingsPath?: string;
  readTextFile?: (path: string) => Promise<string>;
  writeTextFile?: (path: string, value: string) => Promise<void>;
  renameFile?: (from: string, to: string) => Promise<void>;
  ensureDirectory?: (path: string) => Promise<void>;
  secretCodec?: SecretCodec;
  defaults?: StoredMauzSettings;
  environmentApiKey?: string | null | undefined;
};

const SETTINGS_FILE_NAME = "mauz-settings.json";
const DEFAULT_ASK_MODEL = "gpt-5.4-mini";
const DEFAULT_CHAT_TITLE_MODEL = "gpt-5.4-nano";
const DEFAULT_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_REALTIME_VOICE = "marin";
const DEFAULT_REALTIME_REASONING_EFFORT = "low";

type SecretCodec = {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

type ApiKeySettingsUpdate = {
  openAiApiKey?: string | null | undefined;
  clearOpenAiApiKey?: boolean | undefined;
};

type StoredMauzSettings = Omit<MauzSettings, "apiKeyConfigured" | "openAiCredentialSource"> & {
  encryptedOpenAiApiKey?: string | undefined;
  installId: string;
};

export type MauzRuntimeSettings = Omit<StoredMauzSettings, "encryptedOpenAiApiKey"> & {
  openAiApiKey?: string | undefined;
};

export class SettingsService {
  private readonly settingsPath: string;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly writeTextFile: (path: string, value: string) => Promise<void>;
  private readonly renameFile: (from: string, to: string) => Promise<void>;
  private readonly ensureDirectory: (path: string) => Promise<void>;
  private readonly secretCodec: SecretCodec;
  private readonly defaults: StoredMauzSettings;
  private readonly environmentApiKey: string | undefined;
  private cachedSettings: StoredMauzSettings | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: SettingsServiceOptions = {}) {
    const rawEnvironmentApiKey =
      "environmentApiKey" in options ? options.environmentApiKey : process.env.OPENAI_API_KEY;

    this.settingsPath = options.settingsPath ?? join(app.getPath("userData"), SETTINGS_FILE_NAME);
    this.readTextFile = options.readTextFile ?? readFileUtf8;
    this.writeTextFile = options.writeTextFile ?? writeFileUtf8;
    this.renameFile = options.renameFile ?? renameFiles;
    this.ensureDirectory = options.ensureDirectory ?? ensureDirectoryExists;
    this.secretCodec = options.secretCodec ?? createSafeStorageCodec();
    this.defaults = options.defaults ?? getDefaultSettings();
    this.environmentApiKey = normalizeApiKey(rawEnvironmentApiKey);
  }

  async get(): Promise<MauzSettings> {
    return toPublicSettings(await this.getStored(), this.environmentApiKey, this.secretCodec);
  }

  async getRuntime(): Promise<MauzRuntimeSettings> {
    const stored = await this.getStored();
    const { encryptedOpenAiApiKey: _encryptedOpenAiApiKey, ...runtimeSettings } = stored;
    const savedApiKey = decryptStoredApiKey(stored, this.secretCodec);
    const runtimeApiKey = stored.openAiAuthDisconnected ? undefined : (savedApiKey ?? this.environmentApiKey);

    return {
      ...runtimeSettings,
      ...(runtimeApiKey ? { openAiApiKey: runtimeApiKey } : {})
    };
  }

  async update(update: MauzSettingsUpdate): Promise<MauzSettings> {
    return this.runSerializedWrite(async () => {
      const parsedUpdate = MauzSettingsUpdateSchema.parse(update);
      const currentSettings = await this.getStored();
      const nextSettings: StoredMauzSettings = { ...currentSettings };

      applyDefinedSetting(nextSettings, "nativeShakeEnabled", parsedUpdate.nativeShakeEnabled);
      applyDefinedSetting(nextSettings, "devHotkeyEnabled", parsedUpdate.devHotkeyEnabled);
      applyDefinedSetting(nextSettings, "shakeSensitivity", parsedUpdate.shakeSensitivity);
      applyDefinedSetting(nextSettings, "openAiAuthMode", parsedUpdate.openAiAuthMode);
      applyDefinedSetting(nextSettings, "openAiAuthDisconnected", parsedUpdate.openAiAuthDisconnected);
      applyDefinedSetting(nextSettings, "askModel", parsedUpdate.askModel);
      applyDefinedSetting(nextSettings, "chatTitleModel", parsedUpdate.chatTitleModel);
      applyDefinedSetting(nextSettings, "realtimeModel", parsedUpdate.realtimeModel);
      applyDefinedSetting(nextSettings, "realtimeVoice", parsedUpdate.realtimeVoice);
      applyDefinedSetting(nextSettings, "realtimeReasoningEffort", parsedUpdate.realtimeReasoningEffort);
      applyDefinedSetting(nextSettings, "includeFullScreenshot", parsedUpdate.includeFullScreenshot);
      applyDefinedSetting(nextSettings, "backendPreset", parsedUpdate.backendPreset);
      applyDefinedSetting(nextSettings, "backendBaseUrl", parsedUpdate.backendBaseUrl);
      applyDefinedSetting(nextSettings, "agentMode", parsedUpdate.agentMode);
      applyApiKeyUpdate(nextSettings, parsedUpdate, this.secretCodec);

      await this.ensureDirectory(dirname(this.settingsPath));
      const tempPath = `${this.settingsPath}.${process.pid}.${Date.now()}.tmp`;
      await this.writeTextFile(tempPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
      await this.renameFile(tempPath, this.settingsPath);
      this.cachedSettings = nextSettings;

      return toPublicSettings(nextSettings, this.environmentApiKey, this.secretCodec);
    });
  }

  private async runSerializedWrite<T>(operation: () => Promise<T>): Promise<T> {
    const previousWrite = this.writeQueue;
    let releaseCurrentWrite!: () => void;

    this.writeQueue = new Promise<void>((resolve) => {
      releaseCurrentWrite = resolve;
    });

    await previousWrite;

    try {
      return await operation();
    } finally {
      releaseCurrentWrite();
    }
  }

  private async getStored(): Promise<StoredMauzSettings> {
    if (this.cachedSettings !== null) {
      return this.cachedSettings;
    }

    let rawSettings: string | undefined;

    try {
      rawSettings = await this.readTextFile(this.settingsPath);
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

    // Attempt to salvage the installId from raw file content so that a transient
    // read failure or a failed schema migration does not silently rotate the
    // installation identity and persist a new UUID on the next update().
    const salvagedInstallId = rawSettings !== undefined ? salvageInstallId(rawSettings) : null;
    const fallback =
      salvagedInstallId !== null ? { ...this.defaults, installId: salvagedInstallId } : this.defaults;

    this.cachedSettings = fallback;
    return fallback;
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

function applyApiKeyUpdate(
  settings: StoredMauzSettings,
  update: ApiKeySettingsUpdate,
  secretCodec: SecretCodec
): void {
  if (update.clearOpenAiApiKey === true || update.openAiApiKey === null) {
    delete settings.encryptedOpenAiApiKey;
  }

  if (typeof update.openAiApiKey !== "string") {
    return;
  }

  const normalizedApiKey = normalizeApiKey(update.openAiApiKey);

  if (normalizedApiKey === undefined) {
    return;
  }

  if (!secretCodec.isAvailable()) {
    throw new Error("Mauz could not save the OpenAI API key securely on this Mac.");
  }

  try {
    settings.encryptedOpenAiApiKey = secretCodec.encrypt(normalizedApiKey);
    settings.openAiAuthDisconnected = false;
  } catch {
    throw new Error("Mauz could not save the OpenAI API key securely on this Mac.");
  }
}

function getDefaultSettings(): StoredMauzSettings {
  return {
    nativeShakeEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_NATIVE_INPUT, true),
    devHotkeyEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_DEV_HOTKEY, true),
    shakeSensitivity: "normal",
    openAiAuthMode: "api-key",
    openAiAuthDisconnected: false,
    askModel: process.env.OPENAI_ASK_MODEL?.trim() || DEFAULT_ASK_MODEL,
    chatTitleModel: process.env.OPENAI_CHAT_TITLE_MODEL?.trim() || DEFAULT_CHAT_TITLE_MODEL,
    realtimeModel: process.env.OPENAI_REALTIME_MODEL?.trim() || DEFAULT_REALTIME_MODEL,
    realtimeVoice: process.env.OPENAI_REALTIME_VOICE?.trim() || DEFAULT_REALTIME_VOICE,
    realtimeReasoningEffort:
      process.env.OPENAI_REALTIME_REASONING_EFFORT === "medium" ||
      process.env.OPENAI_REALTIME_REASONING_EFFORT === "high"
        ? process.env.OPENAI_REALTIME_REASONING_EFFORT
        : DEFAULT_REALTIME_REASONING_EFFORT,
    includeFullScreenshot: readBooleanEnv(process.env.OPENAI_INCLUDE_FULL_SCREENSHOT, false),
    backendPreset:
      process.env.MAUZ_BACKEND_PRESET === "hermes" ||
      process.env.MAUZ_BACKEND_PRESET === "custom"
        ? (process.env.MAUZ_BACKEND_PRESET as BackendPreset)
        : "openai",
    backendBaseUrl: process.env.MAUZ_BACKEND_BASE_URL?.trim() ?? "",
    agentMode: process.env.MAUZ_AGENT_MODE === "yolo" ? ("yolo" as AgentMode) : "approve",
    installId: randomUUID()
  };
}

function parseStoredSettings(parsed: unknown): StoredMauzSettings | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const defaults = getDefaultSettings();
  // Legacy migration: normalize any unrecognized preset to "hermes"
  const validPresets = new Set(["openai", "hermes", "custom"]);
  const migratedRecord =
    typeof parsedRecord.backendPreset === "string" && !validPresets.has(parsedRecord.backendPreset)
      ? { ...parsedRecord, backendPreset: "hermes" }
      : parsedRecord;
  const candidate = {
    ...defaults,
    ...migratedRecord,
    apiKeyConfigured: false,
    openAiCredentialSource: "none"
  };
  const publicSettings = MauzSettingsSchema.safeParse(candidate);

  if (!publicSettings.success) {
    return null;
  }

  const encryptedOpenAiApiKey =
    typeof parsedRecord.encryptedOpenAiApiKey === "string" &&
    parsedRecord.encryptedOpenAiApiKey.trim().length > 0
      ? parsedRecord.encryptedOpenAiApiKey.trim()
      : undefined;

  return {
    nativeShakeEnabled: publicSettings.data.nativeShakeEnabled,
    devHotkeyEnabled: publicSettings.data.devHotkeyEnabled,
    shakeSensitivity: publicSettings.data.shakeSensitivity,
    openAiAuthMode: publicSettings.data.openAiAuthMode,
    openAiAuthDisconnected: publicSettings.data.openAiAuthDisconnected,
    askModel: publicSettings.data.askModel,
    chatTitleModel: publicSettings.data.chatTitleModel,
    realtimeModel: publicSettings.data.realtimeModel,
    realtimeVoice: publicSettings.data.realtimeVoice,
    realtimeReasoningEffort: publicSettings.data.realtimeReasoningEffort,
    includeFullScreenshot: publicSettings.data.includeFullScreenshot,
    backendPreset: publicSettings.data.backendPreset,
    backendBaseUrl: publicSettings.data.backendBaseUrl,
    agentMode: publicSettings.data.agentMode,
    installId:
      typeof parsedRecord.installId === "string" && parsedRecord.installId.trim().length > 0
        ? parsedRecord.installId.trim()
        : defaults.installId,
    ...(encryptedOpenAiApiKey === undefined ? {} : { encryptedOpenAiApiKey })
  };
}

function shouldSanitizeStoredSettings(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  return (
    "openAiApiKey" in parsed ||
    ("openAiAuthMode" in parsed && parsed.openAiAuthMode !== "api-key") ||
    !("installId" in parsed) ||
    ("backendPreset" in parsed && typeof parsed.backendPreset === "string" && !["openai", "hermes", "custom"].includes(parsed.backendPreset as string))
  );
}

function toPublicSettings(
  settings: StoredMauzSettings,
  environmentApiKey: string | undefined,
  secretCodec: SecretCodec
): MauzSettings {
  const openAiCredentialSource = getOpenAiCredentialSource(settings, environmentApiKey, secretCodec);

  return {
    nativeShakeEnabled: settings.nativeShakeEnabled,
    devHotkeyEnabled: settings.devHotkeyEnabled,
    shakeSensitivity: settings.shakeSensitivity,
    openAiAuthMode: settings.openAiAuthMode,
    openAiAuthDisconnected: settings.openAiAuthDisconnected,
    openAiCredentialSource,
    askModel: settings.askModel,
    chatTitleModel: settings.chatTitleModel,
    realtimeModel: settings.realtimeModel,
    realtimeVoice: settings.realtimeVoice,
    realtimeReasoningEffort: settings.realtimeReasoningEffort,
    includeFullScreenshot: settings.includeFullScreenshot,
    apiKeyConfigured: openAiCredentialSource !== "none",
    backendPreset: settings.backendPreset,
    backendBaseUrl: settings.backendBaseUrl,
    agentMode: settings.agentMode
  };
}

function getOpenAiCredentialSource(
  settings: StoredMauzSettings,
  environmentApiKey: string | undefined,
  secretCodec: SecretCodec
): OpenAiCredentialSource {
  if (settings.openAiAuthDisconnected) {
    return "none";
  }

  if (decryptStoredApiKey(settings, secretCodec) !== undefined) {
    return "saved";
  }

  if (environmentApiKey !== undefined) {
    return "environment";
  }

  return "none";
}

function decryptStoredApiKey(settings: StoredMauzSettings, secretCodec: SecretCodec): string | undefined {
  if (settings.encryptedOpenAiApiKey === undefined || !secretCodec.isAvailable()) {
    return undefined;
  }

  try {
    return normalizeApiKey(secretCodec.decrypt(settings.encryptedOpenAiApiKey));
  } catch {
    return undefined;
  }
}

function createSafeStorageCodec(): SecretCodec {
  return {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value).toString("base64"),
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64"))
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

async function renameFiles(from: string, to: string): Promise<void> {
  await rename(from, to);
}

async function ensureDirectoryExists(path: string): Promise<void> {
  await mkdir(path, {
    recursive: true
  });
}

const INSTALL_ID_PATTERN = /"installId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i;

function salvageInstallId(raw: string): string | null {
  return INSTALL_ID_PATTERN.exec(raw)?.[1] ?? null;
}
