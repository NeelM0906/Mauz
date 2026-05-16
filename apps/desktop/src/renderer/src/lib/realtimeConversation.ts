import type { MauzDesktopContext, ScreenshotPayload } from "@mauzai/shared";

export type VoiceState =
  | "connecting"
  | "listening"
  | "user_speaking"
  | "thinking"
  | "mauz_speaking"
  | "muted"
  | "stopped"
  | "error";

export type RealtimeServerEvent = {
  type: string;
  eventId?: string | undefined;
  itemId?: string | undefined;
  responseId?: string | undefined;
  delta?: string | undefined;
  transcript?: string | undefined;
  outputIndex?: number | undefined;
  contentIndex?: number | undefined;
};

export type RealtimeTranscriptCue = {
  role: "user" | "assistant";
  id: string;
  text: string;
  kind: "delta" | "final";
};

export type SendableDataChannel = {
  send(message: string): void;
};

type ToggleableAudioTrack = {
  enabled: boolean;
  stop?: () => void;
};

type AudioStreamLike = {
  getAudioTracks(): ToggleableAudioTrack[];
};

export function getVoiceStateForRealtimeEvent(
  event: RealtimeServerEvent,
  options: { muted: boolean }
): VoiceState | null {
  if (event.type === "input_audio_buffer.speech_started") {
    return options.muted ? "muted" : "user_speaking";
  }

  if (event.type === "input_audio_buffer.speech_stopped" || event.type === "response.created") {
    return options.muted ? "muted" : "thinking";
  }

  if (event.type === "response.audio.delta" || event.type === "response.output_audio.delta") {
    return "mauz_speaking";
  }

  if (event.type === "response.done") {
    return options.muted ? "muted" : "listening";
  }

  if (event.type === "error") {
    return "error";
  }

  return null;
}

export function getTranscriptCueForRealtimeEvent(event: RealtimeServerEvent): RealtimeTranscriptCue | null {
  if (event.type === "conversation.item.input_audio_transcription.delta") {
    return toTranscriptCue(event, "user", event.delta, "delta");
  }

  if (event.type === "conversation.item.input_audio_transcription.completed") {
    return toTranscriptCue(event, "user", event.transcript, "final");
  }

  if (
    event.type === "response.output_audio_transcript.delta" ||
    event.type === "response.audio_transcript.delta"
  ) {
    return toTranscriptCue(event, "assistant", event.delta, "delta");
  }

  if (
    event.type === "response.output_audio_transcript.done" ||
    event.type === "response.audio_transcript.done"
  ) {
    return toTranscriptCue(event, "assistant", event.transcript, "final");
  }

  return null;
}

export function setMicrophoneMuted(stream: AudioStreamLike | null, muted: boolean): void {
  for (const track of stream?.getAudioTracks() ?? []) {
    track.enabled = !muted;
  }
}

export function stopRealtimeMedia(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) {
    track.stop();
  }
}

export function sendInitialContext(dataChannel: SendableDataChannel, context: MauzDesktopContext): void {
  sendConversationMessage(dataChannel, [
    {
      type: "input_text",
      text: buildRealtimeContextText(context)
    },
    ...getInitialImages(context)
  ]);
}

export function parseRealtimeEvent(data: unknown): RealtimeServerEvent | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as unknown;

    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      const event = parsed as { type?: unknown };

      if (typeof event.type === "string") {
        return {
          type: event.type,
          eventId: getStringField(event, "event_id"),
          itemId: getStringField(event, "item_id"),
          responseId: getStringField(event, "response_id"),
          delta: getStringField(event, "delta"),
          transcript: getStringField(event, "transcript"),
          outputIndex: getNumberField(event, "output_index"),
          contentIndex: getNumberField(event, "content_index")
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function getPrimaryImage(context: MauzDesktopContext | null): ScreenshotPayload | undefined {
  return context?.pointer?.cursorCrop ?? context?.pointer?.screenshot ?? context?.screenshot;
}

export function getContextLabel(context: MauzDesktopContext | null): string {
  if (context?.selectedText?.trim()) {
    return "selected text";
  }

  if (context?.pointer?.cursorCrop !== undefined) {
    return "cursor area";
  }

  if (context?.screenshot !== undefined || context?.pointer?.screenshot !== undefined) {
    return "screenshot";
  }

  return "cursor";
}

function sendConversationMessage(dataChannel: SendableDataChannel, content: unknown[]): void {
  dataChannel.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content
      }
    })
  );
}

function buildRealtimeContextText(context: MauzDesktopContext): string {
  const selectedText = context.selectedText ?? context.pointer?.selectedText;

  return [
    "The user started a voice conversation with Mauz.",
    "Use this desktop context to resolve this, that, and here.",
    "Priority: selected text > cursor crop > active window metadata > full screenshot > cursor position.",
    `Cursor: (${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)})`,
    `Selected text: ${selectedText?.trim() ? selectedText : "none provided"}`,
    `Active app: ${context.activeApp?.name ?? context.pointer?.activeApp?.name ?? "unknown"}`,
    `Active window: ${context.activeWindow?.title ?? context.pointer?.activeWindow?.title ?? "unknown"}`
  ].join("\n");
}

function getInitialImages(context: MauzDesktopContext): unknown[] {
  const images: unknown[] = [];

  if (context.pointer?.cursorCrop !== undefined) {
    images.push(toInputImage(context.pointer.cursorCrop));
  }

  const screenshot = context.pointer?.screenshot ?? context.screenshot;

  if (screenshot !== undefined) {
    images.push(toInputImage(screenshot));
  }

  return images;
}

function toInputImage(image: ScreenshotPayload): { type: "input_image"; image_url: string; detail: "auto" } {
  return {
    type: "input_image",
    image_url: `data:${image.mimeType};base64,${image.base64}`,
    detail: "auto"
  };
}

function toTranscriptCue(
  event: RealtimeServerEvent,
  role: RealtimeTranscriptCue["role"],
  text: string | undefined,
  kind: RealtimeTranscriptCue["kind"]
): RealtimeTranscriptCue | null {
  if (text === undefined) {
    return null;
  }

  const id =
    event.itemId ??
    event.responseId ??
    event.eventId ??
    `${role}:${event.outputIndex ?? 0}:${event.contentIndex ?? 0}`;

  return {
    role,
    id,
    text,
    kind
  };
}

function getStringField(event: { [key: string]: unknown }, key: string): string | undefined {
  const value = event[key];

  return typeof value === "string" ? value : undefined;
}

function getNumberField(event: { [key: string]: unknown }, key: string): number | undefined {
  const value = event[key];

  return typeof value === "number" ? value : undefined;
}
