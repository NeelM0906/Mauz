import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { app, safeStorage } from "electron";
import {
  AiProviderPreferenceSchema,
  DEFAULT_CAPTURE_BLOCKED_SITES,
  MauzSettingsSchema,
  MauzSettingsUpdateSchema,
  TaskAgentPreferenceSchema,
  readBooleanEnv,
  type MauzSettings,
  type TaskAgentPreference,
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
  environmentAnthropicApiKey?: string | null | undefined;
};

const SETTINGS_FILE_NAME = "mauz-settings.json";
const DEFAULT_ASK_MODEL = "gpt-5.4-mini";

/** Password managers: never screenshot or read their windows. Executables (Windows) and bundle ids (macOS). */
export const DEFAULT_CAPTURE_BLOCKED_APPS = [
  "1Password.exe",
  "Bitwarden.exe",
  "KeePass.exe",
  "KeePassXC.exe",
  "Dashlane.exe",
  "LastPass.exe",
  "keeperpasswordmanager.exe",
  "NordPass.exe",
  "Proton Pass.exe",
  "com.1password.1password",
  "com.bitwarden.desktop",
  "org.keepassxc.keepassxc",
  "com.nordpass.macos.NordPass",
  "me.proton.pass.electron"
] as const;

type SecretCodec = {
  isAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
};

type ApiKeySettingsUpdate = {
  openAiApiKey?: string | null | undefined;
  clearOpenAiApiKey?: boolean | undefined;
};

type AnthropicKeySettingsUpdate = {
  anthropicApiKey?: string | null | undefined;
  clearAnthropicApiKey?: boolean | undefined;
};

type StoredMauzSettings = Omit<
  MauzSettings,
  "apiKeyConfigured" | "openAiCredentialSource" | "anthropicKeyConfigured"
> & {
  encryptedOpenAiApiKey?: string | undefined;
  encryptedAnthropicApiKey?: string | undefined;
};

export type MauzRuntimeSettings = Omit<
  StoredMauzSettings,
  "encryptedOpenAiApiKey" | "encryptedAnthropicApiKey"
> & {
  openAiApiKey?: string | undefined;
  anthropicApiKey?: string | undefined;
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
  private readonly environmentAnthropicApiKey: string | undefined;
  private cachedSettings: StoredMauzSettings | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(options: SettingsServiceOptions = {}) {
    const rawEnvironmentApiKey =
      "environmentApiKey" in options ? options.environmentApiKey : process.env.OPENAI_API_KEY;
    const rawEnvironmentAnthropicApiKey =
      "environmentAnthropicApiKey" in options
        ? options.environmentAnthropicApiKey
        : process.env.ANTHROPIC_API_KEY;

    this.settingsPath = options.settingsPath ?? join(app.getPath("userData"), SETTINGS_FILE_NAME);
    this.readTextFile = options.readTextFile ?? readFileUtf8;
    this.writeTextFile = options.writeTextFile ?? writeFileUtf8;
    this.renameFile = options.renameFile ?? renameFiles;
    this.ensureDirectory = options.ensureDirectory ?? ensureDirectoryExists;
    this.secretCodec = options.secretCodec ?? createSafeStorageCodec();
    this.defaults = options.defaults ?? getDefaultSettings();
    this.environmentApiKey = normalizeApiKey(rawEnvironmentApiKey);
    this.environmentAnthropicApiKey = normalizeApiKey(rawEnvironmentAnthropicApiKey);
  }

  async get(): Promise<MauzSettings> {
    return toPublicSettings(
      await this.getStored(),
      this.environmentApiKey,
      this.environmentAnthropicApiKey,
      this.secretCodec
    );
  }

  async getRuntime(): Promise<MauzRuntimeSettings> {
    const stored = await this.getStored();
    const {
      encryptedOpenAiApiKey: _encryptedOpenAiApiKey,
      encryptedAnthropicApiKey: _encryptedAnthropicApiKey,
      ...runtimeSettings
    } = stored;
    const runtimeApiKey = decryptStoredApiKey(stored, this.secretCodec) ?? this.environmentApiKey;
    const anthropicApiKey =
      decryptSecret(stored.encryptedAnthropicApiKey, this.secretCodec) ?? this.environmentAnthropicApiKey;

    return {
      ...runtimeSettings,
      ...(runtimeApiKey ? { openAiApiKey: runtimeApiKey } : {}),
      ...(anthropicApiKey ? { anthropicApiKey } : {})
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
      applyDefinedSetting(nextSettings, "askModel", parsedUpdate.askModel);
      applyDefinedSetting(
        nextSettings,
        "captureBlockedApps",
        normalizeAppList(parsedUpdate.captureBlockedApps)
      );
      applyDefinedSetting(
        nextSettings,
        "captureBlockedSites",
        normalizeAppList(parsedUpdate.captureBlockedSites)
      );
      applyDefinedSetting(nextSettings, "taskAgent", parsedUpdate.taskAgent);
      applyDefinedSetting(nextSettings, "taskFolder", parsedUpdate.taskFolder);
      applyDefinedSetting(nextSettings, "taskAgentFolders", parsedUpdate.taskAgentFolders);
      applyDefinedSetting(nextSettings, "aiProvider", parsedUpdate.aiProvider);
      applyApiKeyUpdate(nextSettings, parsedUpdate, this.secretCodec);
      applyAnthropicKeyUpdate(nextSettings, parsedUpdate, this.secretCodec);

      await this.ensureDirectory(dirname(this.settingsPath));
      const tempPath = `${this.settingsPath}.${process.pid}.${Date.now()}.tmp`;
      await this.writeTextFile(tempPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
      await this.renameFile(tempPath, this.settingsPath);
      this.cachedSettings = nextSettings;

      return toPublicSettings(
        nextSettings,
        this.environmentApiKey,
        this.environmentAnthropicApiKey,
        this.secretCodec
      );
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

    try {
      const parsed = JSON.parse(await this.readTextFile(this.settingsPath)) as unknown;
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
    throw new Error("Mauz could not save the OpenAI API key securely on this computer.");
  }

  try {
    settings.encryptedOpenAiApiKey = secretCodec.encrypt(normalizedApiKey);
  } catch {
    throw new Error("Mauz could not save the OpenAI API key securely on this computer.");
  }
}

function applyAnthropicKeyUpdate(
  settings: StoredMauzSettings,
  update: AnthropicKeySettingsUpdate,
  secretCodec: SecretCodec
): void {
  if (update.clearAnthropicApiKey === true || update.anthropicApiKey === null) {
    delete settings.encryptedAnthropicApiKey;
  }

  const normalizedApiKey =
    typeof update.anthropicApiKey === "string" ? normalizeApiKey(update.anthropicApiKey) : undefined;

  if (normalizedApiKey === undefined) {
    return;
  }

  if (!secretCodec.isAvailable()) {
    throw new Error("Mauz could not save the Anthropic API key securely on this computer.");
  }

  try {
    settings.encryptedAnthropicApiKey = secretCodec.encrypt(normalizedApiKey);
  } catch {
    throw new Error("Mauz could not save the Anthropic API key securely on this computer.");
  }
}

function normalizeAppList(apps: string[] | undefined): string[] | undefined {
  if (apps === undefined) {
    return undefined;
  }

  const seen = new Set<string>();

  return apps.filter((app) => {
    const key = app.trim().toLowerCase();

    if (key.length === 0 || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getDefaultSettings(): StoredMauzSettings {
  return {
    nativeShakeEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_NATIVE_INPUT, true),
    devHotkeyEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_DEV_HOTKEY, true),
    shakeSensitivity: "normal",
    askModel: process.env.OPENAI_ASK_MODEL?.trim() || DEFAULT_ASK_MODEL,
    captureBlockedApps: [...DEFAULT_CAPTURE_BLOCKED_APPS],
    captureBlockedSites: [...DEFAULT_CAPTURE_BLOCKED_SITES],
    taskAgent: TaskAgentPreferenceSchema.catch("auto").parse(process.env.MAUZ_TASK_AGENT?.trim()),
    taskFolder: "",
    taskAgentFolders: {},
    aiProvider: AiProviderPreferenceSchema.catch("auto").parse(process.env.MAUZ_AI_PROVIDER?.trim())
  };
}

function parseStoredSettings(parsed: unknown): StoredMauzSettings | null {
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const parsedRecord = parsed as Record<string, unknown>;
  const defaults = getDefaultSettings();

  const candidate = {
    ...defaults,
    ...parsedRecord,
    taskAgent: resolveStoredTaskAgent(parsedRecord, defaults.taskAgent),
    taskFolder: MauzSettingsSchema.shape.taskFolder.catch(defaults.taskFolder).parse(parsedRecord.taskFolder),
    taskAgentFolders: MauzSettingsSchema.shape.taskAgentFolders
      .catch(defaults.taskAgentFolders)
      .parse(parsedRecord.taskAgentFolders),
    apiKeyConfigured: false,
    openAiCredentialSource: "none",
    anthropicKeyConfigured: false
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
  const encryptedAnthropicApiKey =
    typeof parsedRecord.encryptedAnthropicApiKey === "string" &&
    parsedRecord.encryptedAnthropicApiKey.trim().length > 0
      ? parsedRecord.encryptedAnthropicApiKey.trim()
      : undefined;

  return {
    nativeShakeEnabled: publicSettings.data.nativeShakeEnabled,
    devHotkeyEnabled: publicSettings.data.devHotkeyEnabled,
    shakeSensitivity: publicSettings.data.shakeSensitivity,
    askModel: publicSettings.data.askModel,
    captureBlockedApps: publicSettings.data.captureBlockedApps,
    captureBlockedSites: publicSettings.data.captureBlockedSites,
    taskAgent: publicSettings.data.taskAgent,
    taskFolder: publicSettings.data.taskFolder,
    taskAgentFolders: publicSettings.data.taskAgentFolders,
    aiProvider: publicSettings.data.aiProvider,
    ...(encryptedOpenAiApiKey === undefined ? {} : { encryptedOpenAiApiKey }),
    ...(encryptedAnthropicApiKey === undefined ? {} : { encryptedAnthropicApiKey })
  };
}

function shouldSanitizeStoredSettings(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) {
    return false;
  }

  const parsedRecord = parsed as Record<string, unknown>;

  return (
    "openAiApiKey" in parsed ||
    // Gateway-era fields: rewrite without them.
    LEGACY_GATEWAY_KEYS.some((key) => key in parsedRecord)
  );
}

const LEGACY_GATEWAY_KEYS = ["backendPreset", "assistantMode", "backendBaseUrl", "agentMode"] as const;

/** Someone who used Agentic mode (the Hermes gateway) keeps Hermes as their task agent. */
function resolveStoredTaskAgent(
  parsedRecord: Record<string, unknown>,
  fallback: TaskAgentPreference
): TaskAgentPreference {
  const stored = TaskAgentPreferenceSchema.safeParse(parsedRecord.taskAgent);

  if (stored.success) {
    return stored.data;
  }

  return parsedRecord.assistantMode === "agentic" || parsedRecord.backendPreset === "hermes"
    ? "hermes"
    : fallback;
}

function toPublicSettings(
  settings: StoredMauzSettings,
  environmentApiKey: string | undefined,
  environmentAnthropicApiKey: string | undefined,
  secretCodec: SecretCodec
): MauzSettings {
  const openAiCredentialSource = getOpenAiCredentialSource(settings, environmentApiKey, secretCodec);
  const anthropicKeyConfigured =
    decryptSecret(settings.encryptedAnthropicApiKey, secretCodec) !== undefined ||
    environmentAnthropicApiKey !== undefined;

  return {
    nativeShakeEnabled: settings.nativeShakeEnabled,
    devHotkeyEnabled: settings.devHotkeyEnabled,
    shakeSensitivity: settings.shakeSensitivity,
    openAiCredentialSource,
    askModel: settings.askModel,
    captureBlockedApps: [...settings.captureBlockedApps],
    captureBlockedSites: [...settings.captureBlockedSites],
    apiKeyConfigured: openAiCredentialSource !== "none",
    taskAgent: settings.taskAgent,
    taskFolder: settings.taskFolder,
    taskAgentFolders: { ...settings.taskAgentFolders },
    aiProvider: settings.aiProvider,
    anthropicKeyConfigured
  };
}

function getOpenAiCredentialSource(
  settings: StoredMauzSettings,
  environmentApiKey: string | undefined,
  secretCodec: SecretCodec
): OpenAiCredentialSource {
  if (decryptStoredApiKey(settings, secretCodec) !== undefined) {
    return "saved";
  }

  if (environmentApiKey !== undefined) {
    return "environment";
  }

  return "none";
}

function decryptStoredApiKey(settings: StoredMauzSettings, secretCodec: SecretCodec): string | undefined {
  return decryptSecret(settings.encryptedOpenAiApiKey, secretCodec);
}

function decryptSecret(encryptedValue: string | undefined, secretCodec: SecretCodec): string | undefined {
  if (encryptedValue === undefined || !secretCodec.isAvailable()) {
    return undefined;
  }

  try {
    return normalizeApiKey(secretCodec.decrypt(encryptedValue));
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
