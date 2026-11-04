import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: vi.fn() }));

import { toScreenBounds } from "../src/main/windows/RegionSelector";

describe("toScreenBounds", () => {
  const display = { x: 1920, y: 0, width: 1440, height: 900 };

  it("offsets the selection by the display origin", () => {
    expect(toScreenBounds({ x: 10, y: 20, width: 300, height: 200 }, display)).toEqual({
      x: 1930,
      y: 20,
      width: 300,
      height: 200
    });
  });

  it("clips to the display and ignores tiny or invalid selections", () => {
    expect(toScreenBounds({ x: 1400, y: 880, width: 300, height: 300 }, display)).toEqual({
      x: 3320,
      y: 880,
      width: 40,
      height: 20
    });
    expect(toScreenBounds({ x: 10, y: 10, width: 4, height: 200 }, display)).toBeNull();
    expect(toScreenBounds(null, display)).toBeNull();
    expect(toScreenBounds({ x: "1", y: 2, width: 3, height: 4 }, display)).toBeNull();
  });
});
