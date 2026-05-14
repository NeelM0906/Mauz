import { describe, expect, it, vi } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import {
  canSendScreenFrame,
  getVoiceStateForRealtimeEvent,
  parseRealtimeEvent,
  sendScreenFrame,
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
      type: "response.created"
    });
    expect(parseRealtimeEvent("{bad json")).toBeNull();
  });
});

describe("Realtime mute and screen frame behavior", () => {
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

  it("screen frames update visual context without triggering response.create", () => {
    const sentMessages: string[] = [];
    const context = createContextWithScreenshot();

    sendScreenFrame(
      {
        send: (message) => {
          sentMessages.push(message);
        }
      },
      context
    );

    expect(sentMessages).toHaveLength(1);
    expect(JSON.parse(sentMessages[0] ?? "{}")).toMatchObject({
      type: "conversation.item.create"
    });
    expect(sentMessages.join("\n")).not.toContain("response.create");
  });

  it("screen pause and mic mute are independent controls", () => {
    expect(
      canSendScreenFrame({
        screenPaused: false,
        dataChannelReady: true
      })
    ).toBe(true);
    expect(
      canSendScreenFrame({
        screenPaused: true,
        dataChannelReady: true
      })
    ).toBe(false);
  });
});

function createContextWithScreenshot(): MauzDesktopContext {
  return {
    timestamp: "2026-05-14T20:00:00.000Z",
    platform: "darwin",
    cursor: {
      x: 100,
      y: 200
    },
    pointer: {
      cursor: {
        x: 100,
        y: 200
      },
      screenshot: {
        mimeType: "image/jpeg",
        base64: "abc123",
        width: 1280,
        height: 720
      }
    }
  };
}
