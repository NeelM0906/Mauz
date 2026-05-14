import type { PermissionError, ScreenshotPayload } from "@mauzai/shared";

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
};

type ThumbnailLike = {
  isEmpty(): boolean;
  getSize(): {
    width: number;
    height: number;
  };
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
const JPEG_QUALITY = 75;

export class ScreenshotService {
  constructor(private readonly deps?: ScreenshotServiceDeps) {}

  async captureDisplayNear(point: Point): Promise<ScreenshotPayload> {
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

    const size = source.thumbnail.getSize();
    const jpegImage = source.thumbnail.toJPEG?.(JPEG_QUALITY);

    if (jpegImage !== undefined && jpegImage.byteLength > 0) {
      return {
        mimeType: "image/jpeg",
        base64: jpegImage.toString("base64"),
        width: size.width,
        height: size.height
      };
    }

    const pngImage = source.thumbnail.toPNG();

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

async function loadElectronDeps(): Promise<ScreenshotServiceDeps> {
  const electron = await import("electron");

  return {
    desktopCapturer: electron.desktopCapturer,
    screen: electron.screen
  };
}
