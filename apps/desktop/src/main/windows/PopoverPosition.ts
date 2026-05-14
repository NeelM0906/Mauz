export type Point = {
  x: number;
  y: number;
};

export type Size = {
  width: number;
  height: number;
};

export type WorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PopoverPositionOptions = {
  cursorOffset: number;
  screenMargin: number;
};

export function getClampedPopoverPosition(
  point: Point,
  workArea: WorkArea,
  size: Size,
  options: PopoverPositionOptions
): Point {
  const proposedX =
    point.x + options.cursorOffset + size.width > workArea.x + workArea.width
      ? point.x - options.cursorOffset - size.width
      : point.x + options.cursorOffset;
  const proposedY =
    point.y + options.cursorOffset + size.height > workArea.y + workArea.height
      ? point.y - options.cursorOffset - size.height
      : point.y + options.cursorOffset;

  return {
    x: clamp(
      proposedX,
      workArea.x + options.screenMargin,
      workArea.x + workArea.width - size.width - options.screenMargin
    ),
    y: clamp(
      proposedY,
      workArea.y + options.screenMargin,
      workArea.y + workArea.height - size.height - options.screenMargin
    )
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
