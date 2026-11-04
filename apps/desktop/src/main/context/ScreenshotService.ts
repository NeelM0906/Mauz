import type {
  Bounds,
  CursorCropFocus,
  PermissionError,
  PointerContext,
  ScreenshotPayload
} from "@mauzai/shared";

type Point = {
  x: number;
  y: number;
};

type Size = {
  width: number;
  height: number;
};

type DisplayLike = {
  id: number;
  size: {
    width: number;
    height: number;
  };
  bounds?: Bounds;
  scaleFactor?: number;
};

type ThumbnailLike = {
  isEmpty(): boolean;
  getSize(): {
    width: number;
    height: number;
  };
  crop?(rect: Bounds): ThumbnailLike;
  resize?(options: { width: number; height: number; quality?: "good" | "better" | "best" }): ThumbnailLike;
  toJPEG?(quality: number): Buffer;
  toPNG(): Buffer;
};

type DesktopCapturerSourceLike = {
  display_id?: string;
  thumbnail: ThumbnailLike;
};

type DesktopCapturerLike = {
  getSources(options: {
    types: Array<"screen">;
    thumbnailSize: {
      width: number;
      height: number;
    };
  }): Promise<DesktopCapturerSourceLike[]>;
};

type ScreenLike = {
  getDisplayNearestPoint(point: Point): DisplayLike;
};

type SystemPreferencesLike = {
  getMediaAccessStatus(mediaType: "screen"): string;
};

export type ScreenshotServiceDeps = {
  desktopCapturer: DesktopCapturerLike;
  screen: ScreenLike;
  /** Present on macOS only; used to pre-check Screen Recording permission. */
  systemPreferences?: SystemPreferencesLike;
};

/** Where to frame the pointer crop. All bounds are screen DIPs. */
export type PointerCaptureFocus = {
  /** The pointed element or the group around it, best first. */
  targets?: readonly Bounds[] | undefined;
  /** The window under the pointer; crops stay inside it. */
  window?: Bounds | undefined;
  /** An area the user selected; cropped exactly, ignoring the targets and the window. */
  region?: Bounds | undefined;
};

export class ScreenshotCaptureError extends Error {
  readonly permission: PermissionError["permission"];

  constructor(message: string, permission: PermissionError["permission"] = "screen-recording") {
    super(message);
    this.name = "ScreenshotCaptureError";
    this.permission = permission;
  }
}

// Captured near native resolution so crops of small elements stay legible.
const MAX_CAPTURE_WIDTH = 2560;
const MAX_OVERVIEW_SIZE: Size = { width: 1280, height: 1280 };
const MAX_CROP_OUTPUT_SIZE: Size = { width: 1280, height: 960 };
// Sizes below are DIPs.
const POINTER_AREA_SIZE: Size = { width: 900, height: 600 };
const TARGET_PADDING = 16;
const MIN_TARGET_CROP_SIZE: Size = { width: 360, height: 240 };
const MAX_TARGET_SIZE: Size = { width: 1400, height: 1000 };
const JPEG_QUALITY = 80;

export class ScreenshotService {
  constructor(private readonly deps?: ScreenshotServiceDeps) {}

  async captureDisplayNear(point: Point): Promise<ScreenshotPayload> {
    const { source } = await this.captureSourceNear(point);

    return encodeImage(fitWithin(source.thumbnail, MAX_OVERVIEW_SIZE));
  }

  /**
   * Crops the screen around what the pointer is on: the pointed element when its bounds are
   * known and reasonably sized, otherwise a fixed area around the pointer. Crops stay inside
   * the pointed window. The window image is returned only if the crop fails.
   */
  async capturePointerContext(point: Point, focus: PointerCaptureFocus = {}): Promise<PointerContext> {
    const { display, source } = await this.captureSourceNear(point);
    const displayBounds = getDisplayBounds(display);
    const displayMetadata: NonNullable<PointerContext["display"]> = {
      id: String(display.id),
      bounds: displayBounds
    };

    if (display.scaleFactor !== undefined) {
      displayMetadata.scaleFactor = display.scaleFactor;
    }

    const pointerContext: PointerContext = {
      cursor: point,
      display: displayMetadata
    };
    const frame = getFrame(point, displayBounds, focus.window);

    try {
      const region = focus.region === undefined ? undefined : intersect(focus.region, displayBounds);
      const { rect, kind } =
        region === undefined
          ? chooseCropRect(point, frame, focus.targets ?? [])
          : { rect: region, kind: "region" as const };
      const crop = fitWithin(cropImage(source.thumbnail, rect, displayBounds), MAX_CROP_OUTPUT_SIZE);
      const cropSize = crop.getSize();

      pointerContext.cursorCrop = encodeImage(crop);
      pointerContext.cursorCropFocus = {
        kind,
        pointer: {
          x: Math.round(((point.x - rect.x) * cropSize.width) / Math.max(rect.width, 1)),
          y: Math.round(((point.y - rect.y) * cropSize.height) / Math.max(rect.height, 1))
        }
      } satisfies CursorCropFocus;
    } catch (error) {
      // The user asked about exactly that area; a wider image would show more than they chose.
      if (focus.region !== undefined) {
        throw error;
      }

      pointerContext.screenshot = encodeImage(
        fitWithin(frameImage(source.thumbnail, frame, displayBounds), MAX_OVERVIEW_SIZE)
      );
    }

    return pointerContext;
  }

  private async captureSourceNear(point: Point): Promise<{
    display: DisplayLike;
    source: DesktopCapturerSourceLike;
  }> {
    const deps = this.deps ?? (await loadElectronDeps());

    // On macOS, desktopCapturer.getSources may silently return a blank image when
    // Screen Recording permission is denied rather than throwing.  Pre-check so
    // the existing ScreenshotCaptureError path (and the UI note) is exercised.
    if (deps.systemPreferences !== undefined) {
      const status = deps.systemPreferences.getMediaAccessStatus("screen");

      if (status === "denied" || status === "restricted") {
        throw new ScreenshotCaptureError(
          "Mauz needs Screen Recording permission to capture screenshot context."
        );
      }
    }

    const display = deps.screen.getDisplayNearestPoint(point);
    const thumbnailSize = getThumbnailSize(display);
    const sources = await getSources(deps, thumbnailSize);

    if (sources.length === 0) {
      throw new ScreenshotCaptureError(
        "Mauz needs Screen Recording permission to capture screenshot context."
      );
    }

    const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];

    if (source === undefined || source.thumbnail.isEmpty()) {
      throw new ScreenshotCaptureError("The selected screen source did not return an image.");
    }

    return {
      display,
      source
    };
  }
}

function encodeImage(image: ThumbnailLike): ScreenshotPayload {
  const size = image.getSize();
  const jpegImage = image.toJPEG?.(JPEG_QUALITY);

  if (jpegImage !== undefined && jpegImage.byteLength > 0) {
    return {
      mimeType: "image/jpeg",
      base64: jpegImage.toString("base64"),
      width: size.width,
      height: size.height
    };
  }

  const pngImage = image.toPNG();

  if (pngImage.byteLength === 0) {
    throw new ScreenshotCaptureError("The captured screenshot image was empty.");
  }

  return {
    mimeType: "image/png",
    base64: pngImage.toString("base64"),
    width: size.width,
    height: size.height
  };
}

/** The pointed window clipped to the display, or the display when the window is unknown or elsewhere. */
function getFrame(point: Point, displayBounds: Bounds, window: Bounds | undefined): Bounds {
  const frame = window === undefined ? undefined : intersect(window, displayBounds);

  return frame !== undefined && contains(frame, point) ? frame : displayBounds;
}

function chooseCropRect(
  point: Point,
  frame: Bounds,
  targets: readonly Bounds[]
): { rect: Bounds; kind: CursorCropFocus["kind"] } {
  for (const target of targets) {
    if (target.width > MAX_TARGET_SIZE.width || target.height > MAX_TARGET_SIZE.height) {
      continue;
    }

    const padded = pad(target, TARGET_PADDING);

    if (!contains(padded, point)) {
      continue;
    }

    return { rect: clampInto(growAround(padded, MIN_TARGET_CROP_SIZE), frame), kind: "element" };
  }

  const area = {
    x: point.x - POINTER_AREA_SIZE.width / 2,
    y: point.y - POINTER_AREA_SIZE.height / 2,
    ...POINTER_AREA_SIZE
  };

  return { rect: clampInto(area, frame), kind: "pointer-area" };
}

function cropImage(image: ThumbnailLike, rect: Bounds, displayBounds: Bounds): ThumbnailLike {
  if (image.crop === undefined) {
    throw new ScreenshotCaptureError("The captured screenshot image could not be cropped.");
  }

  const crop = image.crop(toImageRect(rect, displayBounds, image.getSize()));

  if (crop.isEmpty()) {
    throw new ScreenshotCaptureError("The captured cursor area image was empty.");
  }

  return crop;
}

function frameImage(image: ThumbnailLike, frame: Bounds, displayBounds: Bounds): ThumbnailLike {
  if (image.crop === undefined || sameBounds(frame, displayBounds)) {
    return image;
  }

  const crop = image.crop(toImageRect(frame, displayBounds, image.getSize()));

  return crop.isEmpty() ? image : crop;
}

function fitWithin(image: ThumbnailLike, max: Size): ThumbnailLike {
  const size = image.getSize();
  const ratio = Math.min(1, max.width / Math.max(size.width, 1), max.height / Math.max(size.height, 1));

  if (ratio >= 1 || image.resize === undefined) {
    return image;
  }

  return image.resize({
    width: Math.max(1, Math.round(size.width * ratio)),
    height: Math.max(1, Math.round(size.height * ratio)),
    quality: "good"
  });
}

/** Maps a DIP rectangle on the display to whole pixels in the captured image. */
function toImageRect(rect: Bounds, displayBounds: Bounds, imageSize: Size): Bounds {
  const scaleX = imageSize.width / Math.max(displayBounds.width, 1);
  const scaleY = imageSize.height / Math.max(displayBounds.height, 1);
  const left = clamp(Math.round((rect.x - displayBounds.x) * scaleX), 0, imageSize.width - 1);
  const top = clamp(Math.round((rect.y - displayBounds.y) * scaleY), 0, imageSize.height - 1);
  const right = clamp(
    Math.round((rect.x + rect.width - displayBounds.x) * scaleX),
    left + 1,
    imageSize.width
  );
  const bottom = clamp(
    Math.round((rect.y + rect.height - displayBounds.y) * scaleY),
    top + 1,
    imageSize.height
  );

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function pad(rect: Bounds, amount: number): Bounds {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2
  };
}

function growAround(rect: Bounds, min: Size): Bounds {
  const width = Math.max(rect.width, min.width);
  const height = Math.max(rect.height, min.height);

  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width,
    height
  };
}

/** Shifts a rectangle inside the frame, shrinking it only if it is larger than the frame. */
function clampInto(rect: Bounds, frame: Bounds): Bounds {
  const width = Math.min(rect.width, frame.width);
  const height = Math.min(rect.height, frame.height);

  return {
    x: clamp(rect.x, frame.x, frame.x + frame.width - width),
    y: clamp(rect.y, frame.y, frame.y + frame.height - height),
    width,
    height
  };
}

function intersect(a: Bounds, b: Bounds): Bounds | undefined {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);

  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : undefined;
}

function contains(rect: Bounds, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function sameBounds(a: Bounds, b: Bounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function getDisplayBounds(display: DisplayLike): Bounds {
  return (
    display.bounds ?? {
      x: 0,
      y: 0,
      width: display.size.width,
      height: display.size.height
    }
  );
}

async function getSources(
  deps: ScreenshotServiceDeps,
  thumbnailSize: {
    width: number;
    height: number;
  }
): Promise<DesktopCapturerSourceLike[]> {
  try {
    return await deps.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize
    });
  } catch {
    throw new ScreenshotCaptureError("Mauz needs Screen Recording permission to capture screenshot context.");
  }
}

function getThumbnailSize(display: DisplayLike): { width: number; height: number } {
  const scaleFactor = display.scaleFactor ?? 1;
  const pixelWidth = display.size.width * scaleFactor;
  const pixelHeight = display.size.height * scaleFactor;
  const ratio = Math.min(1, MAX_CAPTURE_WIDTH / Math.max(pixelWidth, 1));

  return {
    width: Math.max(1, Math.round(pixelWidth * ratio)),
    height: Math.max(1, Math.round(pixelHeight * ratio))
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

async function loadElectronDeps(): Promise<ScreenshotServiceDeps> {
  const electron = await import("electron");

  return {
    desktopCapturer: electron.desktopCapturer,
    screen: electron.screen,
    ...(process.platform === "darwin" ? { systemPreferences: electron.systemPreferences } : {})
  };
}
