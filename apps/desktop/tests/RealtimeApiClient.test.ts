import { describe, expect, it } from "vitest";
import { LOCAL_API_TOKEN_HEADER, type RealtimeConnectRequest } from "@mauzai/shared";
import { connectRealtimeToLocalApi, getFriendlyRealtimeApiError } from "../src/main/ipc/realtimeApiClient";
import type { FetchLike } from "../src/main/ipc/askApiClient";

const validRequest: RealtimeConnectRequest = {
  offerSdp: "v=0\r\nt=- 0 0\r\n",
  mode: "talk",
  context: {
    timestamp: "2026-05-14T20:00:00.000Z",
    platform: "darwin",
    cursor: {
      x: 100,
      y: 200
    }
  }
};

describe("connectRealtimeToLocalApi", () => {
  it("sends the local API token header", async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      expect(init.headers).toMatchObject({
        [LOCAL_API_TOKEN_HEADER]: "test-token"
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({
          answerSdp: "v=0\r\nt=- 0 0\r\n",
          model: "test-realtime-model"
        })
      };
    };

    await expect(
      connectRealtimeToLocalApi(
        {
          baseUrl: "http://127.0.0.1:47891",
          port: 47891,
          stop: async () => {}
        },
        "test-token",
        validRequest,
        fetchImpl
      )
    ).resolves.toEqual({
      answerSdp: "v=0\r\nt=- 0 0\r\n",
      model: "test-realtime-model"
    });
  });

  it("maps missing API key errors to a friendly message", async () => {
    const fetchImpl: FetchLike = async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        error: "OPENAI_API_KEY is not configured."
      })
    });

    await expect(
      connectRealtimeToLocalApi(
        {
          baseUrl: "http://127.0.0.1:47891",
          port: 47891,
          stop: async () => {}
        },
        "test-token",
        validRequest,
        fetchImpl
      )
    ).rejects.toThrow("Add OPENAI_API_KEY to your .env file, then restart Mauz.");
  });
});

describe("getFriendlyRealtimeApiError", () => {
  it("does not expose local token failures as raw auth details", () => {
    expect(
      getFriendlyRealtimeApiError(401, {
        error: "Unauthorized local Mauz API request."
      })
    ).toBe("Mauz local API rejected the Realtime request. Restart Mauz and try again.");
  });
});
