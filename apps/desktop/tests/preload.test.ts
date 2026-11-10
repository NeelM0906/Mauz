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

  it("sends only the channel for a no-payload call and exactly one payload otherwise", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    const close = mauzApi.menu.close as (...args: unknown[]) => Promise<void>;
    const status = mauzApi.providers.status as (...args: unknown[]) => Promise<unknown>;

    void close({ type: "click" });
    void status();
    void status({ refresh: true }, "extra");

    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(1, IPC_CHANNELS.menuClose);
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(2, IPC_CHANNELS.providersStatus, undefined);
    expect(electron.ipcRenderer.invoke).toHaveBeenNthCalledWith(3, IPC_CHANNELS.providersStatus, {
      refresh: true
    });
  });

  it("passes on permission errors and connect states only when they match the schema", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    const onPermissionError = vi.fn();
    const onConnectState = vi.fn();
    const state = {
      connectId: "c1",
      providerId: "codex",
      phase: "waiting",
      url: null,
      userCode: null,
      acceptsPastedCode: false,
      message: null
    };

    mauzApi.events.onPermissionError(onPermissionError);
    mauzApi.providers.onConnectState(onConnectState);
    electron.emit(IPC_CHANNELS.permissionError, { permission: "accessibility", message: "Allow it." });
    electron.emit(IPC_CHANNELS.permissionError, { permission: "camera", message: "No." });
    electron.emit(IPC_CHANNELS.providersConnectState, state);
    electron.emit(IPC_CHANNELS.providersConnectState, { ...state, phase: "unknown" });

    expect(onPermissionError).toHaveBeenCalledOnce();
    expect(onPermissionError).toHaveBeenCalledWith({ permission: "accessibility", message: "Allow it." });
    expect(onConnectState).toHaveBeenCalledOnce();
    expect(onConnectState).toHaveBeenCalledWith(state);
  });

  it("rejects a settings update whose result fails the settings schema", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    electron.ipcRenderer.invoke.mockResolvedValueOnce({ nativeShakeEnabled: "yes" });

    await expect(mauzApi.settings.update({ askModel: "gpt-5.4-mini" })).rejects.toThrow();
    expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.settingsUpdate, {
      askModel: "gpt-5.4-mini"
    });
  });

  it("passes on an Ask delta only when it matches the schema", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    const onDelta = vi.fn();

    mauzApi.ask.onDelta(onDelta);
    electron.emit(IPC_CHANNELS.askDelta, { requestId: "req-1", text: "partial" });
    electron.emit(IPC_CHANNELS.askDelta, { text: 42 });

    expect(onDelta).toHaveBeenCalledOnce();
    expect(onDelta).toHaveBeenCalledWith({ requestId: "req-1", text: "partial" });
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
