import { describe, expect, it } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { buildContextText, buildResponseContent } from "../src/openai/askMauz";
import { MAUZ_SYSTEM_PROMPT } from "../src/prompts/mauzSystemPrompt";

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

describe("Ask Mauz prompt payload", () => {
  it("sends the cursor crop before the full screenshot", () => {
    const content = buildResponseContent(requestWithPointerContext);

    expect(content).toHaveLength(3);
    expect(content[0]).toMatchObject({
      type: "input_text"
    });
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,cursor-crop-base64",
      detail: "auto"
    });
    expect(content[2]).toMatchObject({
      type: "input_image",
      image_url: "data:image/jpeg;base64,full-screenshot-base64",
      detail: "auto"
    });
  });

  it("describes pointer priority for vague this-or-that questions", () => {
    const contextText = buildContextText(requestWithPointerContext);

    expect(contextText).toContain(
      "Reference resolution priority: selected text > cursor-centered crop > active window metadata > full screenshot > cursor position."
    );
    expect(contextText).toContain("cursor-centered crop image/jpeg, 768x576");
    expect(MAUZ_SYSTEM_PROMPT).toContain(
      "resolve the reference in this order: selected text, cursor-centered crop, active window metadata, full screenshot, cursor position"
    );
  });
});
