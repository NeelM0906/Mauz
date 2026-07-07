import { describe, expect, it, vi, afterEach } from "vitest";

const apiServerMock = vi.hoisted(() => ({
  stopRun: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("@mauzai/api/server", () => ({
  stopRun: apiServerMock.stopRun
}));

import { AgentRunBridge } from "../src/main/agent/AgentRunBridge";

function createWebContentsStub() {
  return { send: vi.fn(), isDestroyed: () => false };
}

describe("AgentRunBridge", () => {
  afterEach(() => {
    apiServerMock.stopRun.mockReset();
    apiServerMock.stopRun.mockResolvedValue(undefined);
    delete process.env.MAUZ_BACKEND_BASE_URL;
  });
  it("forwards approval requests to the popover and resolves with the user's choice", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    const pending = bridge.runHooks.onApprovalRequest!({
      runId: "run_1",
      description: "edit file",
      raw: {}
    });
    const [channel, payload] = webContents.send.mock.calls[0]!;
    expect(channel).toBe("mauz:agent:approval-request");
    expect(payload).toMatchObject({ runId: "run_1", description: "edit file" });

    bridge.respondToApproval(payload.approvalId, "once");
    await expect(pending).resolves.toBe("once");
  });

  it("denies when no popover window is available", async () => {
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => null });
    await expect(bridge.runHooks.onApprovalRequest!({ runId: "r", description: "x", raw: {} })).resolves.toBe(
      "deny"
    );
  });

  it("settles outstanding pending approvals to 'deny' when the run finishes", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    bridge.runHooks.onRunStarted!({ runId: "run_7" });
    const pending = bridge.runHooks.onApprovalRequest!({ runId: "run_7", description: "rm -rf /", raw: {} });

    // Run finishes (e.g. server-side crash) before the user responds
    bridge.runHooks.onRunFinished!({ runId: "run_7" });

    await expect(pending).resolves.toBe("deny");
    expect(bridge.activeRunId).toBeNull();
  });

  it("tracks the active run id and pushes run state", () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });
    bridge.runHooks.onRunStarted!({ runId: "run_9" });
    expect(bridge.activeRunId).toBe("run_9");
    expect(webContents.send).toHaveBeenCalledWith("mauz:agent:run-state", { runId: "run_9" });
    bridge.runHooks.onRunFinished!({ runId: "run_9" });
    expect(bridge.activeRunId).toBeNull();
  });

  it("forwards run activity to the popover on the run-activity channel", () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });
    const activity = {
      runId: "run_1",
      kind: "tool.started" as const,
      tool: "terminal",
      label: "terminal — ls ~"
    };
    bridge.runHooks.onRunActivity!(activity);
    expect(webContents.send).toHaveBeenCalledWith("mauz:agent:run-activity", activity);
  });

  it("silently skips run activity when no popover window is available", () => {
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => null });
    expect(() =>
      bridge.runHooks.onRunActivity!({
        runId: "run_1",
        kind: "tool.completed" as const,
        tool: "terminal",
        label: "terminal done"
      })
    ).not.toThrow();
  });

  it("clears currentRunId even when no baseUrl is configured", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    bridge.runHooks.onRunStarted!({ runId: "run_no_base" });
    expect(bridge.activeRunId).toBe("run_no_base");

    delete process.env.MAUZ_BACKEND_BASE_URL;
    await bridge.stopActiveRun();

    expect(bridge.activeRunId).toBeNull();
  });

  it("clears currentRunId even when the stopRun network call fails", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    bridge.runHooks.onRunStarted!({ runId: "run_net_fail" });
    process.env.MAUZ_BACKEND_BASE_URL = "http://localhost:9999";
    apiServerMock.stopRun.mockRejectedValueOnce(new Error("network error"));

    await expect(bridge.stopActiveRun()).resolves.toBeUndefined();
    expect(bridge.activeRunId).toBeNull();
  });

  it("only denies approvals for the finished run, not those belonging to other runs", async () => {
    const webContents = createWebContentsStub();
    const bridge = new AgentRunBridge({ getPopoverWebContents: () => webContents as never });

    bridge.runHooks.onRunStarted!({ runId: "run_A" });
    const approvalForRunA = bridge.runHooks.onApprovalRequest!({
      runId: "run_A",
      description: "action A",
      raw: {}
    });
    // A second approval tagged to a hypothetical concurrent run
    const approvalForRunB = bridge.runHooks.onApprovalRequest!({
      runId: "run_B",
      description: "action B",
      raw: {}
    });

    bridge.runHooks.onRunFinished!({ runId: "run_A" });

    // run_A's approval should be auto-denied
    await expect(approvalForRunA).resolves.toBe("deny");

    // run_B's approval should still be pending — manually resolve it
    const sentCalls = webContents.send.mock.calls.filter(([ch]) => ch === "mauz:agent:approval-request");
    const runBPayload = sentCalls.find(([, p]) => (p as { runId: string }).runId === "run_B")?.[1] as
      | { approvalId: string }
      | undefined;
    expect(runBPayload).toBeDefined();
    bridge.respondToApproval(runBPayload!.approvalId, "once");
    await expect(approvalForRunB).resolves.toBe("once");
  });

  it("calls showPopover when an approval request arrives", () => {
    const webContents = createWebContentsStub();
    const showPopover = vi.fn();
    const bridge = new AgentRunBridge({
      getPopoverWebContents: () => webContents as never,
      showPopover
    });

    bridge.runHooks.onRunStarted!({ runId: "run_show" });
    void bridge.runHooks.onApprovalRequest!({ runId: "run_show", description: "x", raw: {} });

    expect(showPopover).toHaveBeenCalledOnce();
  });
});
