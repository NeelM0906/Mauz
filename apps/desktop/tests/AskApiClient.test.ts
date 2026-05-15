import { describe, expect, it } from "vitest";
import { LOCAL_API_TOKEN_HEADER, type AskMauzRequest } from "@mauzai/shared";
import { getFriendlyAskApiError, submitAskToLocalApi, type FetchLike } from "../src/main/ipc/askApiClient";

const validRequest: AskMauzRequest = {
  question: "What am I looking at?",
  context: {
    timestamp: "2026-05-13T20:00:00.000Z",
    platform: "darwin",
    cursor: {
      x: 100,
      y: 200
    }
  }
};

describe("submitAskToLocalApi", () => {
  it("sends the local API token header", async () => {
    const fetchImpl: FetchLike = async (_url, init) => {
      expect(init.headers).toMatchObject({
        [LOCAL_API_TOKEN_HEADER]: "test-token"
      });

      return {
        ok: true,
        status: 200,
        json: async () => ({
          answer: "Answer",
          model: "test-model"
        })
      };
    };

    await expect(
      submitAskToLocalApi(
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
      answer: "Answer",
      model: "test-model"
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
      submitAskToLocalApi(
        {
          baseUrl: "http://127.0.0.1:47891",
          port: 47891,
          stop: async () => {}
        },
        "test-token",
        validRequest,
        fetchImpl
      )
    ).rejects.toThrow("Configure OpenAI access in Mauz settings, then try again.");
  });
});

describe("getFriendlyAskApiError", () => {
  it("does not expose local token failures as raw auth details", () => {
    expect(
      getFriendlyAskApiError(401, {
        error: "Unauthorized local Mauz API request."
      })
    ).toBe("Mauz local API rejected the request. Restart Mauz and try again.");
  });
});
