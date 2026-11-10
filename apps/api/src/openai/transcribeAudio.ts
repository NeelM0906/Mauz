import OpenAI, { toFile } from "openai";
import { AiProviderError, MissingOpenAIKeyError } from "../errors";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

/** Speech-to-text for Dictate when the user has added an OpenAI API key. */
export async function transcribeWithOpenAi(wavAudio: Buffer): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new MissingOpenAIKeyError();
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL;

  try {
    const transcription = await client.audio.transcriptions.create({
      file: await toFile(wavAudio, "mauz-speech.wav", { type: "audio/wav" }),
      model
    });

    return transcription.text.trim();
  } catch (error) {
    throw new AiProviderError("openai", "OpenAI could not transcribe that audio. Try again.", {
      cause: error
    });
  }
}

export function hasOpenAiTranscription(): boolean {
  return (process.env.OPENAI_API_KEY?.trim().length ?? 0) > 0;
}
