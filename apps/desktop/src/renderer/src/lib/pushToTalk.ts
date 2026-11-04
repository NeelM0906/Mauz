const SPEECH_SAMPLE_RATE = 16_000;

export type RecordedSpeech = {
  base64: string;
  durationMs: number;
};

/** Converts a MediaRecorder clip to 16 kHz mono 16-bit WAV, the format speech engines expect. */
export async function recordingToWav(
  recording: Blob,
  targetSampleRate = SPEECH_SAMPLE_RATE
): Promise<RecordedSpeech> {
  const decodeContext = new AudioContext();

  try {
    const decoded = await decodeContext.decodeAudioData(await recording.arrayBuffer());
    const frameCount = Math.max(1, Math.ceil(decoded.duration * targetSampleRate));
    // A one-channel offline context also mixes stereo microphones down to mono.
    const offline = new OfflineAudioContext(1, frameCount, targetSampleRate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();

    return {
      base64: arrayBufferToBase64(encodeWav(rendered.getChannelData(0), targetSampleRate)),
      durationMs: decoded.duration * 1000
    };
  } finally {
    void decodeContext.close();
  }
}

export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * bytesPerSample, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }

  return buffer;
}

/**
 * Returns the complete sentences in `text` after `fromIndex`, so speech can start while
 * the answer is still streaming.
 */
export function takeCompleteSentences(text: string, fromIndex: number): { text: string; nextIndex: number } {
  const pending = text.slice(fromIndex);
  let lastBoundary = -1;

  for (const match of pending.matchAll(/[.!?](?=\s)|\n/g)) {
    lastBoundary = match.index + match[0].length;
  }

  if (lastBoundary <= 0) {
    return { text: "", nextIndex: fromIndex };
  }

  return { text: pending.slice(0, lastBoundary).trim(), nextIndex: fromIndex + lastBoundary };
}

/** Strips Markdown that would be read aloud literally. */
export function toSpeakableText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/^\s{0,3}(?:#{1,6}|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|_)(.+?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

type SpeechSynthesisLike = Pick<SpeechSynthesis, "speak" | "cancel">;

/** Speaks a streaming answer sentence by sentence with the system voice. */
export class SpeechQueue {
  private spokenIndex = 0;
  private pendingUtterances = 0;
  private cancelled = false;

  constructor(
    private readonly callbacks: { onStart?: () => void; onIdle?: () => void } = {},
    private readonly synthesis: SpeechSynthesisLike = window.speechSynthesis
  ) {}

  get isSpeaking(): boolean {
    return this.pendingUtterances > 0;
  }

  update(textSoFar: string): void {
    const next = takeCompleteSentences(textSoFar, this.spokenIndex);

    if (next.text.length > 0) {
      this.spokenIndex = next.nextIndex;
      this.speak(next.text);
    }
  }

  finish(finalText: string): void {
    const remainder = this.spokenIndex <= finalText.length ? finalText.slice(this.spokenIndex) : "";
    this.spokenIndex = finalText.length;

    if (remainder.trim().length > 0) {
      this.speak(remainder);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.pendingUtterances = 0;
    this.synthesis.cancel();
  }

  private speak(text: string): void {
    const speakable = toSpeakableText(text);

    if (this.cancelled || speakable.length === 0) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(speakable);
    utterance.rate = 1.05;
    utterance.onstart = () => this.callbacks.onStart?.();

    const settle = (): void => {
      if (this.cancelled) {
        return;
      }

      this.pendingUtterances = Math.max(0, this.pendingUtterances - 1);

      if (this.pendingUtterances === 0) {
        this.callbacks.onIdle?.();
      }
    };

    utterance.onend = settle;
    utterance.onerror = settle;
    this.pendingUtterances += 1;
    this.synthesis.speak(utterance);
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}
