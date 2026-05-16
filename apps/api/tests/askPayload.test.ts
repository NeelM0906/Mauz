import { describe, expect, it, vi } from "vitest";
import { LOCAL_API_TOKEN_HEADER, type AskMauzRequest, type RealtimeConnectRequest } from "@mauzai/shared";
import { createMauzApiServer } from "../src/server";

const validRequest: AskMauzRequest = {
  question: "What am I looking at?",
  context: {
    timestamp: new Date("2026-05-13T20:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 120,
      y: 240
    }
  }
};

const validRealtimeRequest: RealtimeConnectRequest = {
  offerSdp: "v=0\r\nt=- 0 0\r\n",
  mode: "talk",
  context: validRequest.context
};

describe("Ask Mauz API", () => {
  it("rejects Ask requests without the configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      askHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: validRequest
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized local Mauz API request."
    });
  });

  it("rejects Ask requests with an invalid configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      askHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      headers: {
        [LOCAL_API_TOKEN_HEADER]: "wrong-local-test-token"
      },
      payload: validRequest
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized local Mauz API request."
    });
  });

  it("accepts Ask requests with the configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      askHandler: async (request) => ({
        answer: `Answered: ${request.question}`,
        model: "test-model"
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      headers: {
        [LOCAL_API_TOKEN_HEADER]: "local-test-token"
      },
      payload: validRequest
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      answer: "Answered: What am I looking at?",
      model: "test-model"
    });
  });

  it("rejects invalid request payloads", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      askHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: {
        question: "",
        context: {
          platform: "darwin"
        }
      }
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid Ask Mauz request."
    });
  });

  it("returns the injected Ask Mauz handler response for valid requests", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      askHandler: async (request) => ({
        answer: `Answered: ${request.question}`,
        model: "test-model"
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/ask",
      payload: validRequest
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      answer: "Answered: What am I looking at?",
      model: "test-model"
    });
  });

  it("reports health", async () => {
    const app = await createMauzApiServer({
      loadEnv: false
    });

    const response = await app.inject({
      method: "GET",
      url: "/healthz"
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("rejects Realtime connect requests without the configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      realtimeConnectHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/realtime/connect",
      payload: validRealtimeRequest
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized local Mauz API request."
    });
  });

  it("rejects Realtime connect requests with an invalid configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      realtimeConnectHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/realtime/connect",
      headers: {
        [LOCAL_API_TOKEN_HEADER]: "wrong-local-test-token"
      },
      payload: validRealtimeRequest
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized local Mauz API request."
    });
  });

  it("marks Realtime connect requests as still in progress after auth and validation", async () => {
    const realtimeConnectHandler = vi.fn(async (request) => ({
      answerSdp: `answer:${request.mode}`,
      model: "test-realtime-model"
    }));
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      realtimeConnectHandler
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/realtime/connect",
      headers: {
        [LOCAL_API_TOKEN_HEADER]: "local-test-token"
      },
      payload: validRealtimeRequest
    });

    await app.close();

    expect(response.statusCode).toBe(501);
    expect(response.json()).toEqual({
      error: "Still working on this."
    });
    expect(realtimeConnectHandler).not.toHaveBeenCalled();
  });

  it("rejects chat title requests without the configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      chatTitleHandler: async () => {
        throw new Error("should not be called");
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat/title",
      payload: {
        question: "What is this?",
        answer: "It is a settings panel."
      }
    });

    await app.close();

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Unauthorized local Mauz API request."
    });
  });

  it("accepts chat title requests with the configured local token", async () => {
    const app = await createMauzApiServer({
      loadEnv: false,
      authToken: "local-test-token",
      chatTitleHandler: async () => ({
        title: "Settings Panel Help",
        model: "gpt-5.4-nano"
      })
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/chat/title",
      headers: {
        [LOCAL_API_TOKEN_HEADER]: "local-test-token"
      },
      payload: {
        question: "What is this?",
        answer: "It is a settings panel."
      }
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      title: "Settings Panel Help",
      model: "gpt-5.4-nano"
    });
  });
});
