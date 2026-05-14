import type { MauzDesktopContext, RealtimeMode, ScreenshotPayload } from "@mauzai/shared";

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

  if (event.type === "response.audio.delta") {
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

export function sendInitialContext(
  dataChannel: SendableDataChannel,
  mode: RealtimeMode,
  context: MauzDesktopContext
): void {
  sendConversationMessage(dataChannel, [
    {
      type: "input_text",
      text: buildRealtimeContextText(mode, context)
    },
    ...getInitialImages(context)
  ]);
}

export function sendScreenFrame(dataChannel: SendableDataChannel, context: MauzDesktopContext): void {
  const image = context.pointer?.screenshot ?? context.screenshot ?? context.pointer?.cursorCrop;

  if (image === undefined) {
    return;
  }

  sendConversationMessage(dataChannel, [
    {
      type: "input_text",
      text: "Updated explicit screen-share frame. Use this as current visual context when the user asks about the screen."
    },
    toInputImage(image)
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
        return { type: event.type };
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

export function hashImage(image: ScreenshotPayload): string {
  return `${image.mimeType}:${image.width}x${image.height}:${image.base64.length}:${image.base64.slice(0, 96)}:${image.base64.slice(-96)}`;
}

export function canSendScreenFrame(options: { screenPaused: boolean; dataChannelReady: boolean }): boolean {
  return !options.screenPaused && options.dataChannelReady;
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

function buildRealtimeContextText(mode: RealtimeMode, context: MauzDesktopContext): string {
  const selectedText = context.selectedText ?? context.pointer?.selectedText;

  return [
    mode === "screen"
      ? "The user started explicit screen sharing with Mauz."
      : "The user started a voice conversation with Mauz.",
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
