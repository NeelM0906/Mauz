import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DictateTranscribeRequest, DictateTranscribeResponse } from "@mauzai/shared";
import type { WindowsContextHelper } from "../context/WindowsContextHelper";

type DictateTranscriberOptions = {
  getWindowsHelper: () => Pick<WindowsContextHelper, "transcribeWav"> | null;
  hasOpenAiKey: () => boolean;
  transcribeWithOpenAi: (wavAudio: Buffer) => Promise<string>;
  writeTempFile?: (path: string, data: Buffer) => Promise<void>;
  removeTempFile?: (path: string) => Promise<void>;
};

/**
 * Dictate speech-to-text. Uses OpenAI when the user added a key (best accuracy),
 * otherwise the offline Windows speech recognizer, so voice works with only a
 * Claude Code or Codex subscription.
 */
export class DictateTranscriber {
  private readonly writeTempFile: (path: string, data: Buffer) => Promise<void>;
  private readonly removeTempFile: (path: string) => Promise<void>;

  constructor(private readonly options: DictateTranscriberOptions) {
    this.writeTempFile = options.writeTempFile ?? ((path, data) => writeFile(path, data));
    this.removeTempFile = options.removeTempFile ?? ((path) => rm(path, { force: true }));
  }

  async transcribe(request: DictateTranscribeRequest): Promise<DictateTranscribeResponse> {
    const audio = Buffer.from(request.audioBase64, "base64");

    if (this.options.hasOpenAiKey()) {
      return { text: await this.options.transcribeWithOpenAi(audio) };
    }

    const windowsHelper = this.options.getWindowsHelper();

    if (windowsHelper !== null) {
      const path = join(tmpdir(), `mauz-dictate-${randomUUID()}.wav`);
      await this.writeTempFile(path, audio);

      try {
        return { text: await windowsHelper.transcribeWav(path) };
      } finally {
        await this.removeTempFile(path).catch(() => {});
      }
    }

    throw new Error(
      "Dictation needs speech recognition. Add an OpenAI API key in Settings to transcribe your voice."
    );
  }
}
