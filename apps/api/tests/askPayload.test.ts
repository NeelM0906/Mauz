import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_API_TOKEN_HEADER,
  AskMauzRequestSchema,
  MauzSettingsSchema,
  type AskMauzRequest
} from "@mauzai/shared";
import { MissingOpenAIKeyError } from "../src/errors";
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
});

function buildContext() {
  return {
    timestamp: new Date("2026-05-13T20:00:00.000Z").toISOString(),
    platform: "darwin" as const,
    cursor: { x: 120, y: 240 }
  };
}

function buildSettingsFixture() {
  return {
    nativeShakeEnabled: true,
    devHotkeyEnabled: false,
    shakeSensitivity: "normal" as const,
    openAiAuthDisconnected: false,
    openAiCredentialSource: "none" as const,
    askModel: "gpt-5.4-mini",
    captureBlockedApps: [],
    captureBlockedSites: [],
    apiKeyConfigured: false,
    aiProvider: "auto" as const,
    anthropicKeyConfigured: false,
    taskAgent: "auto" as const,
    taskFolder: "",
    taskAgentFolders: {}
  };
}

describe("backend schema additions", () => {
  it("parses Task agent settings", () => {
    const settings = MauzSettingsSchema.parse({
      ...buildSettingsFixture(),
      taskAgent: "claude-code",
      taskFolder: "C:/work",
      taskAgentFolders: { "claude-code": "C:/work/mauz" }
    });

    expect(settings.taskAgent).toBe("claude-code");
    expect(settings.taskAgentFolders).toEqual({ "claude-code": "C:/work/mauz" });
  });
});
