import { describe, expect, it } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import {
  describeCapture,
  detectLensObject,
  getLensActionQuestion,
  type LensObject
} from "../src/renderer/src/lib/lensObject";
import type { LensMemory } from "../src/renderer/src/state/useMauzStore";

const mockLensObject: LensObject = {
  id: "selected-text:2024-01-01T00:00:00.000Z:100:200",
  type: "selected-text",
  label: "Selected text in VS Code",
  summary: "A short snippet of code.",
  confidence: 96,
  privacyMode: "Selected text + cursor crop",
  suggestedActions: ["explain", "transform", "remember", "compare"]
};

const mockPinned: LensMemory = {
  id: "pinned:1234567890",
  label: "Terminal output",
  type: "cursor-area",
  summary: "A build error log.",
  createdAt: "2024-01-01T00:00:00.000Z"
};

describe("getLensActionQuestion – pin injection scoped to compare only", () => {
  it("does NOT inject pinned object for explain default prompt", () => {
    const result = getLensActionQuestion("explain", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for transform default prompt", () => {
    const result = getLensActionQuestion("transform", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for ask default prompt", () => {
    const result = getLensActionQuestion("ask", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for explain with a custom question", () => {
    const result = getLensActionQuestion("explain", mockLensObject, mockPinned, "Simplify this");
    expect(result).toBe("Simplify this");
    expect(result).not.toContain("Pinned");
  });

  it("does NOT inject pinned object for transform with a custom question", () => {
    const result = getLensActionQuestion("transform", mockLensObject, mockPinned, "Convert to JSON");
    expect(result).toBe("Convert to JSON");
  });

  it("does NOT inject pinned object for ask with a custom question", () => {
    const result = getLensActionQuestion("ask", mockLensObject, mockPinned, "What is this?");
    expect(result).toBe("What is this?");
  });

  it("DOES inject pinned object for compare with a custom question", () => {
    const result = getLensActionQuestion("compare", mockLensObject, mockPinned, "How do these differ?");
    expect(result).toContain("How do these differ?");
    expect(result).toContain(mockPinned.label);
  });

  it("DOES inject pinned object for compare default prompt when pinned exists", () => {
    const result = getLensActionQuestion("compare", mockLensObject, mockPinned, "");
    expect(result).toContain(mockPinned.label);
    expect(result).toContain(mockPinned.summary);
  });

  it("returns a standalone compare prompt when nothing is pinned", () => {
    const result = getLensActionQuestion("compare", mockLensObject, null, "");
    expect(result).not.toContain("Pinned");
    expect(result).toContain("compare");
  });
});

const crop = { mimeType: "image/jpeg" as const, base64: "Y3JvcA==", width: 360, height: 240 };

const elementContext: MauzDesktopContext = {
  timestamp: "2026-11-04T10:00:00.000Z",
  platform: "win32",
  cursor: { x: 100, y: 200 },
  activeWindow: { title: "Shop" },
  pointer: {
    cursor: { x: 100, y: 200 },
    cursorCrop: crop,
    cursorCropFocus: { kind: "element", pointer: { x: 180, y: 120 } },
    target: {
      source: "windows-uia",
      element: { role: "Text", name: "$328.00" },
      container: { role: "ListItem", text: "Sony WH-1000XM5\n$328.00" },
      window: { title: "Shop", appName: "Microsoft Edge" }
    }
  }
};

describe("detectLensObject and describeCapture", () => {
  it("names the pointed element and what is sent with it", () => {
    const lensObject = detectLensObject(elementContext);

    expect(lensObject).toMatchObject({
      type: "element",
      label: 'Text "$328.00" in Microsoft Edge',
      summary: "Sony WH-1000XM5 $328.00",
      privacyMode: "Element text + element crop"
    });
    expect(describeCapture(elementContext)).toEqual([
      { label: 'Element: Text "$328.00"' },
      { label: "Around it: ListItem", text: "Sony WH-1000XM5 $328.00" },
      { label: "Image: element crop, 360x240", image: crop },
      { label: "Window: Shop" }
    ]);
  });

  it("shows that nothing was captured from a blocked app", () => {
    const context: MauzDesktopContext = {
      timestamp: "2026-11-04T10:00:00.000Z",
      platform: "win32",
      cursor: { x: 1, y: 2 },
      captureBlocked: { appName: "Signal" }
    };

    expect(detectLensObject(context)).toMatchObject({
      type: "blocked",
      label: "Capture blocked in Signal",
      privacyMode: "Nothing captured"
    });
    expect(describeCapture(context)).toEqual([
      { label: "Blocked: Signal", text: "Nothing was captured from this app." }
    ]);
  });

  it("labels a crop around the pointer when no element was read", () => {
    const context: MauzDesktopContext = {
      ...elementContext,
      pointer: {
        cursor: { x: 100, y: 200 },
        cursorCrop: crop,
        cursorCropFocus: { kind: "pointer-area", pointer: { x: 180, y: 120 } }
      }
    };

    expect(detectLensObject(context)).toMatchObject({
      type: "cursor-area",
      privacyMode: "area around pointer"
    });
  });
  it("names a product page from the browser extension", () => {
    const context: MauzDesktopContext = {
      ...elementContext,
      pointer: {
        ...elementContext.pointer!,
        page: {
          browser: "Microsoft Edge",
          url: "https://shop.example.com/p/1",
          product: { name: "Trail Shoe", brand: "Acme", price: "89.99", priceCurrency: "EUR" }
        }
      }
    };

    expect(detectLensObject(context)).toMatchObject({
      type: "page",
      label: "Trail Shoe in Microsoft Edge",
      summary: "Acme · Trail Shoe · 89.99 EUR",
      privacyMode: "Page data + element crop"
    });
    expect(describeCapture(context).map((detail) => detail.label)).toContain("Product data");
  });

  it("labels a selected area with its recognized text", () => {
    const context: MauzDesktopContext = {
      ...elementContext,
      pointer: {
        cursor: { x: 100, y: 200 },
        cursorCrop: crop,
        cursorCropFocus: { kind: "region", pointer: { x: 180, y: 120 } },
        ocrText: "Revenue Q3"
      }
    };

    expect(detectLensObject(context)).toMatchObject({
      type: "region",
      summary: "Revenue Q3",
      privacyMode: "Selected area + recognized text"
    });
    expect(describeCapture(context)).toContainEqual({ label: "Recognized text (OCR)", text: "Revenue Q3" });
  });
});
