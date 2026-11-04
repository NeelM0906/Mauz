import OpenAI, { toFile } from "openai";
import { AiProviderError, MissingOpenAIKeyError } from "../errors";

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";

type TranscriptionClient = Pick<OpenAI, "audio">;

export type TranscribeWithOpenAiOptions = {
  apiKey?: string | undefined;
  model?: string | undefined;
  client?: TranscriptionClient;
};

/** Speech-to-text for push-to-talk turns when the user has added an OpenAI API key. */
export async function transcribeWithOpenAi(
  wavAudio: Buffer,
  options: TranscribeWithOpenAiOptions = {}
): Promise<string> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim();

  if (!apiKey && options.client === undefined) {
    throw new MissingOpenAIKeyError();
  }

  const client = options.client ?? new OpenAI({ apiKey });
  const model =
    options.model ?? (process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || DEFAULT_TRANSCRIPTION_MODEL);

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
