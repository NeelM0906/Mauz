import { describe, expect, it, vi } from "vitest";
import {
  ScreenshotCaptureError,
  ScreenshotService,
  type ScreenshotServiceDeps
} from "../src/main/context/ScreenshotService";
import type { Bounds } from "@mauzai/shared";

function createThumbnail({
  width = 1280,
  height = 720,
  label = "fake-jpeg",
  onCrop
}: {
  width?: number;
  height?: number;
  label?: string;
  onCrop?: (rect: Bounds) => void;
} = {}) {
  return {
    isEmpty: () => false,
    getSize: () => ({
      width,
      height
    }),
    crop: (rect: Bounds) => {
      onCrop?.(rect);

      return createThumbnail({
        width: rect.width,
        height: rect.height,
        label: `crop-${rect.x}-${rect.y}-${rect.width}-${rect.height}`
      });
    },
    toJPEG: () => Buffer.from(label),
    toPNG: () => Buffer.from("fake-png")
  };
}

function createDeps(overrides: Partial<ScreenshotServiceDeps> = {}): ScreenshotServiceDeps {
  return {
    screen: {
      getDisplayNearestPoint: () => ({
        id: 7,
        size: {
          width: 2560,
          height: 1440
        },
        bounds: {
          x: 0,
          y: 0,
          width: 2560,
          height: 1440
        },
        scaleFactor: 2
      })
    },
    desktopCapturer: {
      getSources: async () => [
        {
          display_id: "7",
          thumbnail: createThumbnail()
        }
      ]
    },
    ...overrides
  };
}

describe("ScreenshotService", () => {
  it("returns a JPEG screenshot payload when JPEG encoding is available", async () => {
    const service = new ScreenshotService(createDeps());

    await expect(
      service.captureDisplayNear({
        x: 10,
        y: 20
      })
    ).resolves.toEqual({
      mimeType: "image/jpeg",
      base64: Buffer.from("fake-jpeg").toString("base64"),
      width: 1280,
      height: 720
    });
  });

  it("falls back to PNG when JPEG encoding is unavailable", async () => {
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            {
              display_id: "7",
              thumbnail: {
                isEmpty: () => false,
                getSize: () => ({
                  width: 1280,
                  height: 720
                }),
                toPNG: () => Buffer.from("fake-png")
              }
            }
          ]
        }
      })
    );

    await expect(
      service.captureDisplayNear({
        x: 10,
        y: 20
      })
    ).resolves.toEqual({
      mimeType: "image/png",
      base64: Buffer.from("fake-png").toString("base64"),
      width: 1280,
      height: 720
    });
  });

  it("throws a capture error when no screen sources are available", async () => {
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => []
        }
      })
    );

    const error = await service
      .captureDisplayNear({
        x: 10,
        y: 20
      })
      .catch((captureError: unknown) => captureError);

    expect(error).toBeInstanceOf(ScreenshotCaptureError);
    expect((error as ScreenshotCaptureError).permission).toBe("screen-recording");
  });

  it("throws a capture error when desktopCapturer throws", async () => {
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => {
            throw new Error("permission denied");
          }
        }
      })
    );

    await expect(
      service.captureDisplayNear({
        x: 10,
        y: 20
      })
    ).rejects.toBeInstanceOf(ScreenshotCaptureError);
  });

  it("throws a capture error when the selected thumbnail is empty", async () => {
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            {
              display_id: "7",
              thumbnail: {
                isEmpty: () => true,
                getSize: () => ({
                  width: 0,
                  height: 0
                }),
                toPNG: () => Buffer.alloc(0)
              }
            }
          ]
        }
      })
    );

    await expect(
      service.captureDisplayNear({
        x: 10,
        y: 20
      })
    ).rejects.toBeInstanceOf(ScreenshotCaptureError);
  });

  it("crops a fixed area around the pointer when nothing is known about the target", async () => {
    let cropRect: Bounds | undefined;
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            {
              display_id: "7",
              thumbnail: createThumbnail({
                onCrop: (rect) => {
                  cropRect = rect;
                }
              })
            }
          ]
        }
      })
    );

    const context = await service.capturePointerContext({
      x: 1280,
      y: 720
    });

    // 900x600 DIPs around the pointer, at the image's 0.5 scale.
    expect(cropRect).toEqual({ x: 415, y: 210, width: 450, height: 300 });
    expect(context).toMatchObject({
      cursor: {
        x: 1280,
        y: 720
      },
      display: {
        id: "7",
        scaleFactor: 2,
        bounds: {
          x: 0,
          y: 0,
          width: 2560,
          height: 1440
        }
      },
      cursorCrop: {
        mimeType: "image/jpeg",
        base64: Buffer.from("crop-415-210-450-300").toString("base64"),
        width: 450,
        height: 300
      },
      cursorCropFocus: { kind: "pointer-area", pointer: { x: 225, y: 150 } }
    });
    expect(context.screenshot).toBeUndefined();
  });

  it("frames the crop on the pointed element, grown to a readable minimum", async () => {
    let cropRect: Bounds | undefined;
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            { display_id: "7", thumbnail: createThumbnail({ onCrop: (rect) => (cropRect = rect) }) }
          ]
        }
      })
    );

    const context = await service.capturePointerContext(
      { x: 1100, y: 650 },
      { targets: [{ x: 1000, y: 600, width: 200, height: 100 }] }
    );

    // Padded by 16 to 232x132, grown to 360x240 around its centre: (920, 530) in DIPs.
    expect(cropRect).toEqual({ x: 460, y: 265, width: 180, height: 120 });
    expect(context.cursorCropFocus).toEqual({ kind: "element", pointer: { x: 90, y: 60 } });
  });

  it("skips targets that are too large or do not contain the pointer", async () => {
    const crops: Bounds[] = [];
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            { display_id: "7", thumbnail: createThumbnail({ onCrop: (rect) => crops.push(rect) }) }
          ]
        }
      })
    );

    const oversized = await service.capturePointerContext(
      { x: 1280, y: 720 },
      { targets: [{ x: 0, y: 0, width: 2000, height: 1200 }] }
    );
    const elsewhere = await service.capturePointerContext(
      { x: 1100, y: 650 },
      {
        targets: [
          { x: 0, y: 0, width: 300, height: 300 },
          { x: 900, y: 500, width: 400, height: 300 }
        ]
      }
    );

    expect(oversized.cursorCropFocus?.kind).toBe("pointer-area");
    expect(elsewhere.cursorCropFocus?.kind).toBe("element");
    expect(crops[1]).toEqual({ x: 442, y: 242, width: 216, height: 166 });
  });

  it("keeps crops inside the pointed window", async () => {
    let cropRect: Bounds | undefined;
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            { display_id: "7", thumbnail: createThumbnail({ onCrop: (rect) => (cropRect = rect) }) }
          ]
        }
      })
    );

    await service.capturePointerContext(
      { x: 1600, y: 900 },
      { window: { x: 1500, y: 800, width: 800, height: 500 } }
    );

    // The 900x600 area does not fit, so the crop is the whole window.
    expect(cropRect).toEqual({ x: 750, y: 400, width: 400, height: 250 });
  });

  it("ignores window bounds that do not contain the pointer", async () => {
    let cropRect: Bounds | undefined;
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            { display_id: "7", thumbnail: createThumbnail({ onCrop: (rect) => (cropRect = rect) }) }
          ]
        }
      })
    );

    await service.capturePointerContext(
      { x: 1280, y: 720 },
      { window: { x: 0, y: 0, width: 400, height: 300 } }
    );

    expect(cropRect).toEqual({ x: 415, y: 210, width: 450, height: 300 });
  });

  it("falls back to an image of the pointed window when the crop fails", async () => {
    const crops: Bounds[] = [];
    const image = {
      ...createThumbnail(),
      crop: (rect: Bounds) => {
        crops.push(rect);
        // The first (pointer) crop comes back empty; the window crop works.
        return crops.length === 1
          ? { ...createThumbnail(), isEmpty: () => true }
          : createThumbnail({ width: rect.width, height: rect.height, label: "window" });
      }
    };
    const service = new ScreenshotService(
      createDeps({ desktopCapturer: { getSources: async () => [{ display_id: "7", thumbnail: image }] } })
    );

    const context = await service.capturePointerContext(
      { x: 1600, y: 900 },
      { window: { x: 1000, y: 400, width: 1200, height: 800 } }
    );

    expect(context.cursorCrop).toBeUndefined();
    expect(crops[1]).toEqual({ x: 500, y: 200, width: 600, height: 400 });
    expect(context.screenshot).toEqual({
      mimeType: "image/jpeg",
      base64: Buffer.from("window").toString("base64"),
      width: 600,
      height: 400
    });
  });

  it("captures at native resolution, capped at 2560 pixels wide", async () => {
    const getSources = vi.fn(async () => [{ display_id: "7", thumbnail: createThumbnail() }]);
    const service = new ScreenshotService(createDeps({ desktopCapturer: { getSources } }));

    await service.captureDisplayNear({ x: 10, y: 20 });

    // 2560x1440 DIPs at scale factor 2 is 5120x2880 pixels.
    expect(getSources).toHaveBeenCalledWith({
      types: ["screen"],
      thumbnailSize: { width: 2560, height: 1440 }
    });
  });

  it("downscales images larger than the model needs", async () => {
    const resize = vi.fn(({ width, height }: { width: number; height: number }) =>
      createThumbnail({ width, height, label: "resized" })
    );
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            { display_id: "7", thumbnail: { ...createThumbnail({ width: 2560, height: 1440 }), resize } }
          ]
        }
      })
    );

    const screenshot = await service.captureDisplayNear({ x: 10, y: 20 });

    expect(resize).toHaveBeenCalledWith({ width: 1280, height: 720, quality: "good" });
    expect(screenshot).toMatchObject({ width: 1280, height: 720 });
  });

  it("keeps the full screenshot when cursor crop extraction is unavailable", async () => {
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: {
          getSources: async () => [
            {
              display_id: "7",
              thumbnail: {
                isEmpty: () => false,
                getSize: () => ({
                  width: 1280,
                  height: 720
                }),
                toJPEG: () => Buffer.from("fake-jpeg"),
                toPNG: () => Buffer.from("fake-png")
              }
            }
          ]
        }
      })
    );

    const context = await service.capturePointerContext({
      x: 1280,
      y: 720
    });

    expect(context.cursorCrop).toBeUndefined();
    expect(context.screenshot).toEqual({
      mimeType: "image/jpeg",
      base64: Buffer.from("fake-jpeg").toString("base64"),
      width: 1280,
      height: 720
    });
  });

  it("throws ScreenshotCaptureError before calling getSources when permission is denied", async () => {
    const getSourcesSpy = vi.fn().mockResolvedValue([]);
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: { getSources: getSourcesSpy },
        systemPreferences: { getMediaAccessStatus: () => "denied" }
      })
    );

    await expect(service.captureDisplayNear({ x: 10, y: 20 })).rejects.toBeInstanceOf(ScreenshotCaptureError);
    expect(getSourcesSpy).not.toHaveBeenCalled();
  });

  it("throws ScreenshotCaptureError before calling getSources when permission is restricted", async () => {
    const getSourcesSpy = vi.fn().mockResolvedValue([]);
    const service = new ScreenshotService(
      createDeps({
        desktopCapturer: { getSources: getSourcesSpy },
        systemPreferences: { getMediaAccessStatus: () => "restricted" }
      })
    );

    await expect(service.captureDisplayNear({ x: 10, y: 20 })).rejects.toBeInstanceOf(ScreenshotCaptureError);
    expect(getSourcesSpy).not.toHaveBeenCalled();
  });

  it("proceeds with capture when systemPreferences reports permission granted", async () => {
    const service = new ScreenshotService(
      createDeps({
        systemPreferences: { getMediaAccessStatus: () => "granted" }
      })
    );

    await expect(service.captureDisplayNear({ x: 10, y: 20 })).resolves.toBeDefined();
  });
});
