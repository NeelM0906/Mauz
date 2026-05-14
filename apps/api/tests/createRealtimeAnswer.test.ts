import { describe, expect, it } from "vitest";
import type { RealtimeConnectRequest } from "@mauzai/shared";
import { buildRealtimeInstructions, createRealtimeAnswer } from "../src/openai/createRealtimeAnswer";

const validRealtimeRequest: RealtimeConnectRequest = {
  offerSdp: "v=0\r\nt=- 0 0\r\n",
  mode: "talk",
  context: {
    timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 120,
      y: 240
    }
  }
};

describe("createRealtimeAnswer", () => {
  it("includes non-null server VAD turn detection in the session form payload", async () => {
    let sessionPayload: unknown;

    await createRealtimeAnswer(validRealtimeRequest, {
      apiKey: "test-api-key",
      model: "test-realtime-model",
      fetchImpl: async (_url, init) => {
        expect(init.body).toBeInstanceOf(FormData);

        const formData = init.body as FormData;
        sessionPayload = JSON.parse(String(formData.get("session")));

        return new Response("answer-sdp", {
          status: 200
        });
      }
    });

    const turnDetection = (sessionPayload as { turn_detection?: unknown }).turn_detection;

    expect(turnDetection).not.toBeNull();
    expect(turnDetection).toEqual({
      type: "server_vad",
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 650,
      create_response: true,
      interrupt_response: true
    });
  });

  it("tells screen mode to wait for user speech instead of narrating frames", () => {
    const screenInstructions = buildRealtimeInstructions({
      ...validRealtimeRequest,
      mode: "screen"
    });

    expect(screenInstructions).toContain("Voice is the primary interaction channel.");
    expect(screenInstructions).toContain("Do not narrate every screen change");
    expect(screenInstructions).toContain("Wait for the user to ask");
  });
});
