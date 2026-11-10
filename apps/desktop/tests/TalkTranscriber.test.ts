import { describe, expect, it, vi } from "vitest";
import { TalkTranscriber } from "../src/main/talk/TalkTranscriber";

const REQUEST = { audioBase64: Buffer.from("RIFF-test").toString("base64"), mimeType: "audio/wav" as const };

describe("TalkTranscriber", () => {
  it("uses OpenAI when an OpenAI key is configured", async () => {
    const transcribeWithOpenAi = vi.fn(async () => "hello from openai");
    const transcribeWav = vi.fn();
    const transcriber = new TalkTranscriber({
      getWindowsHelper: () => ({ transcribeWav }),
      hasOpenAiKey: () => true,
      transcribeWithOpenAi
    });

    await expect(transcriber.transcribe(REQUEST)).resolves.toEqual({
      text: "hello from openai"
    });
    expect(transcribeWav).not.toHaveBeenCalled();
  });

  it("falls back to Windows speech recognition and cleans up the temp file", async () => {
    const writeTempFile = vi.fn(async (_path: string, _data: Buffer) => {});
    const removeTempFile = vi.fn(async () => {});
    const transcribeWav = vi.fn(async () => "hello from windows");
    const transcriber = new TalkTranscriber({
      getWindowsHelper: () => ({ transcribeWav }),
      hasOpenAiKey: () => false,
      transcribeWithOpenAi: vi.fn(),
      writeTempFile,
      removeTempFile
    });

    await expect(transcriber.transcribe(REQUEST)).resolves.toEqual({
      text: "hello from windows"
    });
    const writtenPath = writeTempFile.mock.calls[0]?.[0];
    expect(transcribeWav).toHaveBeenCalledWith(writtenPath);
    expect(removeTempFile).toHaveBeenCalledWith(writtenPath);
  });

  it("explains how to enable voice when no speech engine is available", async () => {
    const transcriber = new TalkTranscriber({
      getWindowsHelper: () => null,
      hasOpenAiKey: () => false,
      transcribeWithOpenAi: vi.fn()
    });

    await expect(transcriber.transcribe(REQUEST)).rejects.toThrow(/OpenAI API key/);
  });
});
