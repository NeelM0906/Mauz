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

  it("captures pointer context with a cursor-centered crop", async () => {
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

    expect(cropRect).toEqual({
      x: 256,
      y: 72,
      width: 768,
      height: 576
    });
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
        base64: Buffer.from("crop-256-72-768-576").toString("base64"),
        width: 768,
        height: 576
      },
      screenshot: {
        mimeType: "image/jpeg",
        base64: Buffer.from("fake-jpeg").toString("base64"),
        width: 1280,
        height: 720
      }
    });
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

  it("clamps the cursor crop at the top-left display edge", async () => {
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

    await service.capturePointerContext({
      x: 0,
      y: 0
    });

    expect(cropRect).toEqual({
      x: 0,
      y: 0,
      width: 768,
      height: 576
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

  it("clamps the cursor crop at the bottom-right display edge", async () => {
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

    await service.capturePointerContext({
      x: 2560,
      y: 1440
    });

    expect(cropRect).toEqual({
      x: 512,
      y: 144,
      width: 768,
      height: 576
    });
  });
});
