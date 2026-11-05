import { beforeEach, describe, expect, it, vi } from "vitest";

type IpcListener = (event: unknown, payload: unknown) => void;

const electron = vi.hoisted(() => {
  const listeners = new Map<string, IpcListener>();
  let mauzApi: unknown;

  return {
    contextBridge: {
      exposeInMainWorld: vi.fn((_key: string, api: unknown) => {
        mauzApi = api;
      })
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn((channel: string, listener: IpcListener) => {
        listeners.set(channel, listener);
      }),
      removeListener: vi.fn()
    },
    getMauzApi: () => mauzApi,
    emit: (channel: string, payload: unknown) => listeners.get(channel)?.({}, payload),
    reset: () => {
      listeners.clear();
      mauzApi = undefined;
      vi.clearAllMocks();
    }
  };
});

vi.mock("electron", () => ({
  contextBridge: electron.contextBridge,
  ipcRenderer: electron.ipcRenderer
}));

import { IPC_CHANNELS, type MauzBridge } from "@mauzai/shared";
import "../src/preload/index";

describe("preload bridge", () => {
  beforeEach(() => {
    electron.reset();
    vi.resetModules();
  });

  it("sends Send to agent requests over the task channels", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;

    void mauzApi.task.agents();
    void mauzApi.task.folders({ agentId: "codex" });
    void mauzApi.task.pickFolder();

    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.taskAgents);
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.taskFolders, { agentId: "codex" });
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.taskPickFolder);
  });

  it("tells the renderer when the popover is hidden and can unsubscribe", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    const onHidden = vi.fn();

    const unsubscribe = mauzApi.menu.onHidden(onHidden);
    electron.emit(IPC_CHANNELS.menuHidden, undefined);
    unsubscribe();

    expect(onHidden).toHaveBeenCalledOnce();
    expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.menuHidden,
      expect.any(Function)
    );
  });
});
