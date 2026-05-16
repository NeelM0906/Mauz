import { describe, expect, it, vi } from "vitest";
import {
  getTranscriptCueForRealtimeEvent,
  getVoiceStateForRealtimeEvent,
  parseRealtimeEvent,
  setMicrophoneMuted
} from "../src/renderer/src/lib/realtimeConversation";

describe("Realtime voice event mapping", () => {
  it("maps speech_started to user_speaking", () => {
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "input_audio_buffer.speech_started"
        },
        { muted: false }
      )
    ).toBe("user_speaking");
  });

  it("maps speech_stopped to thinking", () => {
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "input_audio_buffer.speech_stopped"
        },
        { muted: false }
      )
    ).toBe("thinking");
  });

  it("maps response events to speaking then listening", () => {
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "response.audio.delta"
        },
        { muted: false }
      )
    ).toBe("mauz_speaking");
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "response.output_audio.delta"
        },
        { muted: false }
      )
    ).toBe("mauz_speaking");
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "response.done"
        },
        { muted: false }
      )
    ).toBe("listening");
  });

  it("keeps muted state across turn and response completion events", () => {
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "input_audio_buffer.speech_started"
        },
        { muted: true }
      )
    ).toBe("muted");
    expect(
      getVoiceStateForRealtimeEvent(
        {
          type: "response.done"
        },
        { muted: true }
      )
    ).toBe("muted");
  });

  it("parses Realtime event JSON safely", () => {
    expect(parseRealtimeEvent(JSON.stringify({ type: "response.created" }))).toEqual({
      type: "response.created",
      contentIndex: undefined,
      delta: undefined,
      eventId: undefined,
      itemId: undefined,
      outputIndex: undefined,
      responseId: undefined,
      transcript: undefined
    });
    expect(parseRealtimeEvent("{bad json")).toBeNull();
  });

  it("extracts user and assistant transcript cues from Realtime events", () => {
    expect(
      getTranscriptCueForRealtimeEvent({
        type: "conversation.item.input_audio_transcription.delta",
        itemId: "user-item",
        delta: "hello"
      })
    ).toEqual({
      role: "user",
      id: "user-item",
      text: "hello",
      kind: "delta"
    });

    expect(
      getTranscriptCueForRealtimeEvent({
        type: "conversation.item.input_audio_transcription.completed",
        itemId: "user-item",
        transcript: "hello there"
      })
    ).toEqual({
      role: "user",
      id: "user-item",
      text: "hello there",
      kind: "final"
    });

    expect(
      getTranscriptCueForRealtimeEvent({
        type: "response.output_audio_transcript.delta",
        responseId: "response-id",
        delta: "sure"
      })
    ).toEqual({
      role: "assistant",
      id: "response-id",
      text: "sure",
      kind: "delta"
    });
  });
});

describe("Realtime mute behavior", () => {
  it("mute disables audio tracks without stopping them", () => {
    const stop = vi.fn();
    const track = {
      enabled: true,
      stop
    };
    const stream = {
      getAudioTracks: () => [track]
    };

    setMicrophoneMuted(stream, true);

    expect(track.enabled).toBe(false);
    expect(stop).not.toHaveBeenCalled();

    setMicrophoneMuted(stream, false);

    expect(track.enabled).toBe(true);
    expect(stop).not.toHaveBeenCalled();
  });
});
