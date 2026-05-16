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
      audio?: {
        input?: {
          transcription?: unknown;
          turn_detection?: unknown;
        };
        output?: { voice?: unknown };
      };
      turn_detection?: unknown;
    };

    expect(session.type).toBe("realtime");
    expect(session.model).toBe("test-realtime-model");
    expect(session.output_modalities).toEqual(["audio"]);
    expect(session.reasoning).toEqual({ effort: "low" });
    expect(session.turn_detection).toBeUndefined();
    expect(session.audio?.input?.transcription).toEqual({
      model: "gpt-4o-mini-transcribe"
    });
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
      reasoningEffort: "low",
      transcriptionModel: "gpt-4o-transcribe"
    }) as {
      audio?: {
        input?: { transcription?: { model?: string }; turn_detection?: { type?: string } };
        output?: { voice?: string };
      };
      turn_detection?: unknown;
    };

    expect(session.turn_detection).toBeUndefined();
    expect(session.audio?.input?.transcription?.model).toBe("gpt-4o-transcribe");
    expect(session.audio?.input?.turn_detection?.type).toBe("semantic_vad");
    expect(session.audio?.output?.voice).toBe("cedar");
  });

  it("tells talk mode to use only the initial screenshot context", () => {
    const instructions = buildRealtimeInstructions(validRealtimeRequest);

    expect(instructions).toContain("The user explicitly enabled voice chat.");
    expect(instructions).toContain("Use the initial screenshot context only unless they share more context.");
  });

  it("requires an API key for Realtime", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");

    await expect(createRealtimeAnswer(validRealtimeRequest)).rejects.toThrow(
      "Set OPENAI_API_KEY before launching Mauz, then try again."
    );
  });

  it("surfaces OpenAI Realtime validation errors with a safe action message", async () => {
    await expect(
      createRealtimeAnswer(validRealtimeRequest, {
        apiKey: "test-api-key",
        model: "bad-realtime-model",
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              error: {
                message: "The model bad-realtime-model does not exist or you do not have access.",
                type: "invalid_request_error",
                code: "model_not_found",
                param: "model"
              }
            }),
            {
              status: 404
            }
          )
      })
    ).rejects.toThrow(
      "OpenAI could not find or access Realtime model bad-realtime-model. Set OPENAI_REALTIME_MODEL to an available Realtime model."
    );
  });

  it("classifies transport failures before an OpenAI response exists", async () => {
    await expect(
      createRealtimeAnswer(validRealtimeRequest, {
        apiKey: "test-api-key",
        fetchImpl: async () => {
          throw new TypeError("fetch failed");
        }
      })
    ).rejects.toThrow(
      "OpenAI Realtime network request failed. Check internet access and api.openai.com reachability."
    );
  });
});
