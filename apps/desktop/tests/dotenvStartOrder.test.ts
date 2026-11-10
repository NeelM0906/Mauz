import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getPath: () => tmpdir()
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8")
  }
}));

import { loadLocalEnv } from "@mauzai/api/server";
import { SettingsService } from "../src/main/settings/SettingsService";

describe(".env start order", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  const folder = join(tmpdir(), `mauz-dotenv-test-${randomUUID()}`);

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(folder, { recursive: true, force: true });
    // .env files in parent folders can add any variable, so restore the whole environment.
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  it("sees a key that is only in .env, in the order bootstrap() starts services", async () => {
    mkdirSync(folder);
    writeFileSync(join(folder, ".env"), "OPENAI_API_KEY=sk-dotenv\n");
    process.chdir(folder);
    delete process.env.OPENAI_API_KEY;

    // bootstrap(): loadLocalEnv() first, then SettingsService.
    loadLocalEnv();
    const service = new SettingsService({
      settingsPath: join(folder, "settings.json"),
      readTextFile: async () => {
        throw new Error("no file");
      },
      writeTextFile: async () => {},
      renameFile: async () => {},
      ensureDirectory: async () => {}
    });

    expect(process.env.OPENAI_API_KEY).toBe("sk-dotenv"); // Ask uses this key.
    expect((await service.get()).openAiCredentialSource).toBe("environment");
    // applyRuntimeEnvironment() keeps OPENAI_API_KEY on the next save.
    expect((await service.getRuntime()).openAiApiKey).toBe("sk-dotenv");
  });
});
