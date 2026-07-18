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

describe("preload agent event bridge", () => {
  beforeEach(() => {
    electron.reset();
    vi.resetModules();
  });

  it("forwards only valid agent event payloads to renderer callbacks", async () => {
    await import("../src/preload/index");
    const mauzApi = electron.getMauzApi() as MauzBridge;
    const onApprovalRequest = vi.fn();
    const onRunState = vi.fn();
    const onRunActivity = vi.fn();

    mauzApi.agent.onApprovalRequest(onApprovalRequest);
    mauzApi.agent.onRunState(onRunState);
    mauzApi.agent.onRunActivity(onRunActivity);

    electron.emit(IPC_CHANNELS.agentApprovalRequest, {
      approvalId: "approval_1",
      runId: "run_1",
      description: "Write a file"
    });
    electron.emit(IPC_CHANNELS.agentRunState, { runId: null });
    electron.emit(IPC_CHANNELS.agentRunActivity, {
      runId: "run_1",
      kind: "tool.started",
      tool: "read_file",
      label: "Reading file"
    });

    electron.emit(IPC_CHANNELS.agentApprovalRequest, {
      approvalId: 1,
      runId: "run_1",
      description: "Write a file"
    });
    electron.emit(IPC_CHANNELS.agentRunState, { runId: 1 });
    electron.emit(IPC_CHANNELS.agentRunActivity, { runId: "run_1", kind: "unexpected", label: "Unknown" });

    expect(onApprovalRequest).toHaveBeenCalledExactlyOnceWith({
      approvalId: "approval_1",
      runId: "run_1",
      description: "Write a file"
    });
    expect(onRunState).toHaveBeenCalledExactlyOnceWith({ runId: null });
    expect(onRunActivity).toHaveBeenCalledExactlyOnceWith({
      runId: "run_1",
      kind: "tool.started",
      tool: "read_file",
      label: "Reading file"
    });
  });
});
