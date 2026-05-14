import type { ScreenshotPayload } from "@mauzai/shared";

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
  constructor(message: string) {
    super(message);
    this.name = "ScreenshotCaptureError";
  }
}

const MAX_SCREENSHOT_WIDTH = 1280;

export class ScreenshotService {
  constructor(private readonly deps?: ScreenshotServiceDeps) {}

  async captureDisplayNear(point: Point): Promise<ScreenshotPayload> {
    const deps = this.deps ?? (await loadElectronDeps());
    const display = deps.screen.getDisplayNearestPoint(point);
    const thumbnailSize = getThumbnailSize(display);
    const sources = await deps.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize
    });

    if (sources.length === 0) {
      throw new ScreenshotCaptureError("No screen sources were available for screenshot capture.");
    }

    const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];

    if (source === undefined || source.thumbnail.isEmpty()) {
      throw new ScreenshotCaptureError("The selected screen source did not return an image.");
    }

    const size = source.thumbnail.getSize();
    const image = source.thumbnail.toPNG();

    if (image.byteLength === 0) {
      throw new ScreenshotCaptureError("The captured screenshot image was empty.");
    }

    return {
      mimeType: "image/png",
      base64: image.toString("base64"),
      width: size.width,
      height: size.height
    };
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
