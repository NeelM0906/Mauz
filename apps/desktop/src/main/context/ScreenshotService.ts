import type { Bounds, PermissionError, PointerContext, ScreenshotPayload } from "@mauzai/shared";

type Point = {
  x: number;
  y: number;
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

export type ScreenshotServiceDeps = {
  desktopCapturer: DesktopCapturerLike;
  screen: ScreenLike;
};

export class ScreenshotCaptureError extends Error {
  readonly permission: PermissionError["permission"];

  constructor(message: string, permission: PermissionError["permission"] = "screen-recording") {
    super(message);
    this.name = "ScreenshotCaptureError";
    this.permission = permission;
  }
}

const MAX_SCREENSHOT_WIDTH = 1280;
const DEFAULT_POINTER_CROP_SIZE = {
  width: 768,
  height: 576
} as const;
const JPEG_QUALITY = 75;

export class ScreenshotService {
  constructor(private readonly deps?: ScreenshotServiceDeps) {}

  async captureDisplayNear(point: Point): Promise<ScreenshotPayload> {
    const { source } = await this.captureSourceNear(point);

    return encodeImage(source.thumbnail);
  }

  async capturePointerContext(point: Point): Promise<PointerContext> {
    const { display, source } = await this.captureSourceNear(point);
    const screenshot = encodeImage(source.thumbnail);
    const displayMetadata: NonNullable<PointerContext["display"]> = {
      id: String(display.id),
      bounds: getDisplayBounds(display)
    };

    if (display.scaleFactor !== undefined) {
      displayMetadata.scaleFactor = display.scaleFactor;
    }

    const pointerContext: PointerContext = {
      cursor: point,
      display: displayMetadata,
      screenshot
    };

    try {
      pointerContext.cursorCrop = encodeImage(createCursorCrop(source.thumbnail, display, point));
    } catch {
      // The full screenshot remains useful pointer context if crop extraction fails.
    }

    return pointerContext;
  }

  private async captureSourceNear(point: Point): Promise<{
    display: DisplayLike;
    source: DesktopCapturerSourceLike;
  }> {
    const deps = this.deps ?? (await loadElectronDeps());
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

function createCursorCrop(thumbnail: ThumbnailLike, display: DisplayLike, point: Point): ThumbnailLike {
  if (thumbnail.crop === undefined) {
    throw new ScreenshotCaptureError("The captured screenshot image could not be cropped.");
  }

  const imageSize = thumbnail.getSize();
  const cropSize = {
    width: Math.min(DEFAULT_POINTER_CROP_SIZE.width, imageSize.width),
    height: Math.min(DEFAULT_POINTER_CROP_SIZE.height, imageSize.height)
  };
  const displayBounds = getDisplayBounds(display);
  const imagePoint = mapScreenPointToImagePoint(point, displayBounds, imageSize);
  const cropRect = {
    x: clamp(Math.round(imagePoint.x - cropSize.width / 2), 0, imageSize.width - cropSize.width),
    y: clamp(Math.round(imagePoint.y - cropSize.height / 2), 0, imageSize.height - cropSize.height),
    width: cropSize.width,
    height: cropSize.height
  };

  const crop = thumbnail.crop(cropRect);

  if (crop.isEmpty()) {
    throw new ScreenshotCaptureError("The captured cursor area image was empty.");
  }

  return crop;
}

function mapScreenPointToImagePoint(
  point: Point,
  displayBounds: Bounds,
  imageSize: {
    width: number;
    height: number;
  }
): Point {
  const relativeX = (point.x - displayBounds.x) / Math.max(displayBounds.width, 1);
  const relativeY = (point.y - displayBounds.y) / Math.max(displayBounds.height, 1);

  return {
    x: clamp(relativeX, 0, 1) * imageSize.width,
    y: clamp(relativeY, 0, 1) * imageSize.height
  };
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
  const ratio = Math.min(1, MAX_SCREENSHOT_WIDTH / Math.max(display.size.width, 1));

  return {
    width: Math.max(1, Math.round(display.size.width * ratio)),
    height: Math.max(1, Math.round(display.size.height * ratio))
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
    screen: electron.screen
  };
}
