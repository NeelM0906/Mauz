import { describe, expect, it } from "vitest";
import type { MauzDesktopContext } from "@mauzai/shared";
import { describeCapture, detectLensObject } from "../src/renderer/src/lib/lensObject";

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
});
