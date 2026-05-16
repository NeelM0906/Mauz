import { describe, expect, it } from "vitest";
import { parseCodexAuthJson } from "../src/main/auth/OpenAiAuthService";

describe("OpenAiAuthService", () => {
  it("parses managed OpenAI auth tokens from Codex auth.json", () => {
    expect(
      parseCodexAuthJson(
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            access_token: "access-token",
            refresh_token: "refresh-token"
          }
        })
      )
    ).toEqual({
      authMode: "chatgpt",
      accessToken: "access-token",
      refreshToken: "refresh-token"
    });
  });

  it("ignores malformed Codex auth files", () => {
    expect(parseCodexAuthJson("not-json")).toBeNull();
  });
});
