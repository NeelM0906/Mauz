import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { buildCodexExecArgs, getCodexImages } from "../src/openai/codexAuth";

const requestWithPointerContext: AskMauzRequest = {
  question: "What is this?",
  context: {
    timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 640,
      y: 360
    },
    pointer: {
      cursor: {
        x: 640,
        y: 360
      },
      cursorCrop: {
        mimeType: "image/jpeg",
        base64: "cursor-crop-base64",
        width: 768,
        height: 576
      },
      screenshot: {
        mimeType: "image/jpeg",
        base64: "full-screenshot-base64",
        width: 1280,
        height: 720
      }
    }
  }
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ChatGPT auth through Codex", () => {
  it("uses current Codex exec flags without inheriting local agent config", () => {
    const args = buildCodexExecArgs({
      model: "gpt-5.4-mini",
      imagePaths: ["/tmp/crop.jpg"],
      outputPath: "/tmp/answer.txt"
    });

    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain('approval_policy="never"');
    expect(args).not.toContain("--ask-for-approval");
    expect(args).toContain("--image");
    expect(args).toContain("/tmp/crop.jpg");
  });

  it("omits the full screenshot by default when a cursor crop is available", () => {
    const images = getCodexImages(requestWithPointerContext);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      name: "cursor-crop"
    });
  });

  it("can include the full screenshot when broad context is enabled", () => {
    vi.stubEnv("OPENAI_INCLUDE_FULL_SCREENSHOT", "true");

    const images = getCodexImages(requestWithPointerContext);

    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      name: "cursor-crop"
    });
    expect(images[1]).toMatchObject({
      name: "screenshot"
    });
  });
});
