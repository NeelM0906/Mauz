import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MAUZ_API_PORT } from "@mauzai/shared";

const createMauzApiServerMock = vi.hoisted(() => vi.fn());

vi.mock("@mauzai/api/server", () => ({
  createMauzApiServer: createMauzApiServerMock
}));

import { getLocalApiPortCandidates, launchLocalApi } from "../src/main/server/launchLocalApi";

type MockApiServer = {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

describe("launchLocalApi", () => {
  beforeEach(() => {
    createMauzApiServerMock.mockReset();
    delete process.env.MAUZ_API_PORT;
  });

  afterEach(() => {
    delete process.env.MAUZ_API_PORT;
  });

  it("uses the high default Mauz port", () => {
    expect(DEFAULT_MAUZ_API_PORT).toBe(47891);
    expect(getLocalApiPortCandidates(3)).toEqual([47891, 47892, 47893]);
  });

  it("falls forward when the configured port is already in use", async () => {
    process.env.MAUZ_API_PORT = "47891";
    const firstApp = queueMockServer({
      listen: async () => {
        throw createPortInUseError();
      }
    });
    const secondApp = queueMockServer();

    const handle = await launchLocalApi({
      authToken: "local-token",
      maxPortAttempts: 2
    });

    expect(firstApp.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 47891
    });
    expect(firstApp.close).toHaveBeenCalledOnce();
    expect(secondApp.listen).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 47892
    });
    expect(handle).toMatchObject({
      baseUrl: "http://127.0.0.1:47892",
      port: 47892
    });

    await handle.stop();

    expect(secondApp.close).toHaveBeenCalledOnce();
  });

  it("does not swallow non-port startup failures", async () => {
    const fatalError = new Error("fastify failed");
    const app = queueMockServer({
      listen: async () => {
        throw fatalError;
      }
    });

    await expect(
      launchLocalApi({
        authToken: "local-token",
        maxPortAttempts: 2
      })
    ).rejects.toThrow(fatalError);
    expect(app.close).toHaveBeenCalledOnce();
    expect(createMauzApiServerMock).toHaveBeenCalledOnce();
  });
});

function queueMockServer(
  overrides: {
    listen?: () => Promise<void>;
  } = {}
): MockApiServer {
  const app: MockApiServer = {
    listen: vi.fn(overrides.listen ?? (async () => {})),
    close: vi.fn(async () => {})
  };

  createMauzApiServerMock.mockResolvedValueOnce(app);

  return app;
}

function createPortInUseError(): Error & { code: string } {
  return Object.assign(new Error("port already in use"), {
    code: "EADDRINUSE"
  });
}
