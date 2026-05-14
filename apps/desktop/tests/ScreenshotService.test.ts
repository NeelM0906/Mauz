import { describe, expect, it } from "vitest";
import {
  ScreenshotCaptureError,
  ScreenshotService,
  type ScreenshotServiceDeps
} from "../src/main/context/ScreenshotService";

function createDeps(overrides: Partial<ScreenshotServiceDeps> = {}): ScreenshotServiceDeps {
  return {
    screen: {
      getDisplayNearestPoint: () => ({
        id: 7,
        size: {
          width: 2560,
          height: 1440
        }
      })
    },
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
});
