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
  defaults?: MauzSettings;
};

const SETTINGS_FILE_NAME = "mauz-settings.json";

export class SettingsService {
  private readonly settingsPath: string;
  private readonly readTextFile: (path: string) => Promise<string>;
  private readonly writeTextFile: (path: string, value: string) => Promise<void>;
  private readonly ensureDirectory: (path: string) => Promise<void>;
  private readonly defaults: MauzSettings;
  private cachedSettings: MauzSettings | null = null;

  constructor(options: SettingsServiceOptions = {}) {
    this.settingsPath = options.settingsPath ?? join(app.getPath("userData"), SETTINGS_FILE_NAME);
    this.readTextFile = options.readTextFile ?? readFileUtf8;
    this.writeTextFile = options.writeTextFile ?? writeFileUtf8;
    this.ensureDirectory = options.ensureDirectory ?? ensureDirectoryExists;
    this.defaults = options.defaults ?? getDefaultSettings();
  }

  async get(): Promise<MauzSettings> {
    if (this.cachedSettings !== null) {
      return this.cachedSettings;
    }

    try {
      const rawSettings = await this.readTextFile(this.settingsPath);
      const parsedSettings = MauzSettingsSchema.safeParse(JSON.parse(rawSettings));

      if (parsedSettings.success) {
        this.cachedSettings = parsedSettings.data;
        return parsedSettings.data;
      }
    } catch {
      // Missing or malformed settings should never prevent Mauz from starting.
    }

    this.cachedSettings = this.defaults;
    return this.defaults;
  }

  async update(update: MauzSettingsUpdate): Promise<MauzSettings> {
    const parsedUpdate = MauzSettingsUpdateSchema.parse(update);
    const currentSettings = await this.get();
    const nextSettings = MauzSettingsSchema.parse({
      ...currentSettings,
      ...parsedUpdate
    });

    await this.ensureDirectory(dirname(this.settingsPath));
    await this.writeTextFile(this.settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`);
    this.cachedSettings = nextSettings;

    return nextSettings;
  }
}

function getDefaultSettings(): MauzSettings {
  return {
    nativeShakeEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_NATIVE_INPUT, false),
    devHotkeyEnabled: readBooleanEnv(process.env.MAUZ_ENABLE_DEV_HOTKEY, true),
    shakeSensitivity: "normal"
  };
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
