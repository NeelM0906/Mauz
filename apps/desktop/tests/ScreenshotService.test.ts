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
            toPNG: () => Buffer.from("fake-png")
          }
        }
      ]
    },
    ...overrides
  };
}

describe("ScreenshotService", () => {
  it("returns a PNG screenshot payload", async () => {
    const service = new ScreenshotService(createDeps());

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
