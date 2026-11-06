import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskMauzRequest } from "@mauzai/shared";
import { buildAnswerPrompt, buildContextText } from "../src/openai/askMauz";
import { MAUZ_SYSTEM_PROMPT } from "../src/prompts/mauzSystemPrompt";

function buildRequest(): AskMauzRequest {
  return {
    question: "What is this?",
    context: {
      timestamp: new Date("2026-05-13T20:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: { x: 100, y: 200 }
    }
  };
}

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends only the cursor crop by default for faster pointer asks", () => {
    const { images } = buildAnswerPrompt(requestWithPointerContext);

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ mimeType: "image/jpeg", base64: "cursor-crop-base64" });
  });

  it("sends the window screenshot only when there is no cursor crop", () => {
    const { cursorCrop: _cursorCrop, ...pointer } = requestWithPointerContext.context.pointer!;
    const { images } = buildAnswerPrompt({
      ...requestWithPointerContext,
      context: { ...requestWithPointerContext.context, pointer }
    });

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ base64: "full-screenshot-base64" });
  });

  it("ignores the removed full-screenshot environment flag", () => {
    vi.stubEnv("OPENAI_INCLUDE_FULL_SCREENSHOT", "true");

    expect(buildAnswerPrompt(requestWithPointerContext).images).toHaveLength(1);
  });

  it("describes pointer priority for vague this-or-that questions", () => {
    const contextText = buildContextText(requestWithPointerContext);

    expect(contextText).toContain("<image>attached: crop centered on the pointer (768x576)</image>");
    expect(MAUZ_SYSTEM_PROMPT).toContain(
      "mean the selected text if there is any, otherwise the pointed element, otherwise the image"
    );
    expect(MAUZ_SYSTEM_PROMPT).toContain("You are Mauz, an assistant at the user's cursor.");
  });

  it("puts selected text ahead of cursor crop in the text context", () => {
    const contextText = buildContextText({
      ...requestWithPointerContext,
      context: {
        ...requestWithPointerContext.context,
        selectedText: "TypeError: Cannot read properties of undefined"
      }
    });

    expect(contextText).toContain(
      "<selected_text>\nTypeError: Cannot read properties of undefined\n</selected_text>"
    );
    expect(contextText.indexOf("<selected_text>")).toBeLessThan(contextText.indexOf("<image>"));
  });

  it("includes the pointed element read from the app and describes the framed crop", () => {
    const request: AskMauzRequest = {
      ...requestWithPointerContext,
      context: {
        ...requestWithPointerContext.context,
        pointer: {
          ...requestWithPointerContext.context.pointer!,
          cursorCropFocus: { kind: "element", pointer: { x: 120, y: 48 } },
          target: {
            source: "windows-uia",
            element: { role: "Hyperlink", name: "Sony WH-1000XM5", text: "Sony WH-1000XM5 Wireless" },
            container: { role: "ListItem", text: "Sony WH-1000XM5\n$328.00\n4.6 out of 5 stars" },
            window: { title: "Amazon.com : headphones", appName: "Microsoft Edge", executable: "msedge.exe" }
          }
        }
      }
    };
    const contextText = buildContextText(request);

    expect(contextText).toContain('<window>Microsoft Edge — "Amazon.com : headphones"</window>');
    expect(contextText).toContain(
      [
        '<pointed_element source="Windows UI Automation">',
        'Hyperlink "Sony WH-1000XM5"',
        "Text: Sony WH-1000XM5 Wireless",
        "Around it (ListItem): Sony WH-1000XM5",
        "$328.00",
        "4.6 out of 5 stars",
        "</pointed_element>"
      ].join("\n")
    );
    expect(contextText).toContain(
      "crop framed on the pointed element and the group around it (768x576); pointer at (120, 48) in the image"
    );
    expect(buildAnswerPrompt(request).images).toEqual([
      expect.objectContaining({
        label: expect.stringMatching(/^Image 1: crop framed on the pointed element/)
      })
    ]);
  });

  it("sends no image or element text for a blocked app", () => {
    const request: AskMauzRequest = {
      ...requestWithPointerContext,
      context: {
        ...requestWithPointerContext.context,
        captureBlocked: { appName: "Signal" },
        pointer: {
          ...requestWithPointerContext.context.pointer!,
          target: { source: "windows-uia", element: { role: "Edit", name: "Vault item" } }
        }
      }
    };
    const contextText = buildContextText(request);

    expect(buildAnswerPrompt(request).images).toEqual([]);
    expect(contextText).not.toContain("Vault item");
    expect(contextText).toContain(
      "Capture is blocked: the app or site under the pointer is on the user's never-capture list"
    );
    // Naming it would tell the model what the user had open.
    expect(contextText).not.toContain("Signal");
  });

  it("includes browser page data and OCR text", () => {
    const request: AskMauzRequest = {
      ...requestWithPointerContext,
      context: {
        ...requestWithPointerContext.context,
        pointer: {
          ...requestWithPointerContext.context.pointer!,
          ocrText: "Total due: $41.20",
          page: {
            browser: "Microsoft Edge",
            url: "https://shop.example.com/p/1",
            title: "Trail Shoe",
            element: { tag: "span", text: "$89.99" },
            product: { name: "Trail Shoe", brand: "Acme", price: "89.99", priceCurrency: "EUR", size: "8, 9" }
          }
        }
      }
    };
    const contextText = buildContextText(request);

    expect(contextText).toContain('<browser_page browser="');
    expect(contextText).toContain("URL: https://shop.example.com/p/1");
    expect(contextText).toContain('Pointed: <span>, "$89.99"');
    expect(contextText).toContain("Product: name: Trail Shoe; brand: Acme; price: 89.99 EUR; size: 8, 9");
    expect(contextText).toContain("<ocr>\nTotal due: $41.20\n</ocr>");
  });
});
