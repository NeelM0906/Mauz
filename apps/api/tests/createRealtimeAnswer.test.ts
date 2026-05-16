import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeConnectRequest } from "@mauzai/shared";
import {
  buildRealtimeInstructions,
  buildRealtimeSessionConfig,
  createRealtimeAnswer
} from "../src/openai/createRealtimeAnswer";

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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createRealtimeAnswer", () => {
  it("uses a Realtime voice-agent session with semantic turn detection", async () => {
    vi.stubEnv("OPENAI_REALTIME_REASONING_EFFORT", "low");
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

    const session = sessionPayload as {
      type?: unknown;
      model?: unknown;
      output_modalities?: unknown;
      reasoning?: { effort?: unknown };
      audio?: { input?: { turn_detection?: unknown }; output?: { voice?: unknown } };
      turn_detection?: unknown;
    };

    expect(session.type).toBe("realtime");
    expect(session.model).toBe("test-realtime-model");
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.reasoning).toEqual({ effort: "low" });
    expect(session.turn_detection).toBeUndefined();
    expect(session.audio?.input?.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "auto",
      create_response: true,
      interrupt_response: true
    });
    expect(session.audio?.output).toEqual({
      voice: "marin"
    });
  });

  it("builds the same semantic session config without server VAD", () => {
    const session = buildRealtimeSessionConfig(validRealtimeRequest, {
      model: "gpt-realtime-2",
      voice: "cedar",
      reasoningEffort: "low"
    }) as {
      audio?: { input?: { turn_detection?: { type?: string } }; output?: { voice?: string } };
      turn_detection?: unknown;
    };

    expect(session.turn_detection).toBeUndefined();
    expect(session.audio?.input?.turn_detection?.type).toBe("semantic_vad");
    expect(session.audio?.output?.voice).toBe("cedar");
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

  it("requires an API key for Realtime", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(createRealtimeAnswer(validRealtimeRequest)).rejects.toThrow(
      "Set OPENAI_API_KEY before launching Mauz, then try again."
    );
  });
});
