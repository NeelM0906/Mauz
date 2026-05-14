import { describe, expect, it } from "vitest";
import { getClampedPopoverPosition } from "../src/main/windows/PopoverPosition";

const workArea = {
  x: 0,
  y: 0,
  width: 800,
  height: 600
};

const options = {
  cursorOffset: 12,
  screenMargin: 8
};

describe("getClampedPopoverPosition", () => {
  it("places the popover down and right when there is room", () => {
    expect(
      getClampedPopoverPosition(
        {
          x: 100,
          y: 120
        },
        workArea,
        {
          width: 280,
          height: 180
        },
        options
      )
    ).toEqual({
      x: 112,
      y: 132
    });
  });

  it("uses the target size when clamping near the bottom-right edge", () => {
    expect(
      getClampedPopoverPosition(
        {
          x: 790,
          y: 590
        },
        workArea,
        {
          width: 420,
          height: 520
        },
        options
      )
    ).toEqual({
      x: 358,
      y: 58
    });
  });

  it("keeps oversized panels inside the top-left margin", () => {
    expect(
      getClampedPopoverPosition(
        {
          x: 790,
          y: 590
        },
        workArea,
        {
          width: 900,
          height: 700
        },
        options
      )
    ).toEqual({
      x: 8,
      y: 8
    });
  });
});
