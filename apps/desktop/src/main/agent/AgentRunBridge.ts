import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { IPC_CHANNELS } from "@mauzai/shared";
import {
  stopRun,
  type AgentApprovalChoice,
  type AgentApprovalRequest,
  type RunActivityEvent,
  type RunLifecycleHooks
} from "@mauzai/api/server";

type AgentRunBridgeOptions = {
  getPopoverWebContents(): WebContents | null;
  /** Called when an approval request arrives; use to re-show the popover if it was hidden. */
  showPopover?: () => void;
};

type PendingApprovalEntry = {
  runId: string;
  resolve: (choice: AgentApprovalChoice) => void;
};

export class AgentRunBridge {
  readonly runHooks: RunLifecycleHooks;
  private readonly getPopoverWebContents: () => WebContents | null;
  private readonly showPopover: (() => void) | undefined;
  private readonly pendingApprovals = new Map<string, PendingApprovalEntry>();
  private currentRunId: string | null = null;

  constructor(options: AgentRunBridgeOptions) {
    this.getPopoverWebContents = options.getPopoverWebContents;
    this.showPopover = options.showPopover;
    this.runHooks = {
      onApprovalRequest: (request) => this.requestApproval(request),
      onRunStarted: ({ runId }) => this.setActiveRun(runId),
      onRunFinished: ({ runId }) => {
        for (const [approvalId, entry] of this.pendingApprovals) {
          if (entry.runId === runId) {
            this.respondToApproval(approvalId, "deny");
          }
        }
        this.setActiveRun(null);
      },
      onRunActivity: (activity) => this.forwardRunActivity(activity)
    };
  }

  get activeRunId(): string | null {
    return this.currentRunId;
  }

  respondToApproval(approvalId: string, choice: AgentApprovalChoice): void {
    const entry = this.pendingApprovals.get(approvalId);

    if (entry !== undefined) {
      this.pendingApprovals.delete(approvalId);
      entry.resolve(choice);
    }
  }

  async stopActiveRun(): Promise<void> {
    const runId = this.currentRunId;
    const baseUrl = process.env["MAUZ_BACKEND_BASE_URL"]?.trim();

    for (const [approvalId] of this.pendingApprovals) {
      this.respondToApproval(approvalId, "deny");
    }

    // Always clear the active run, even if there is no baseUrl or the network call fails.
    this.setActiveRun(null);

    if (runId === null || !baseUrl) {
      return;
    }

    const apiKey = process.env["MAUZ_BACKEND_API_KEY"]?.trim();

    try {
      await stopRun({ baseUrl, runId, ...(apiKey ? { apiKey } : {}) });
    } catch {
      // The network call is best-effort; the local state was already cleared above.
    }
  }

  private requestApproval(request: AgentApprovalRequest): Promise<AgentApprovalChoice> {
    // Re-show the popover if it was hidden (e.g. focus moved away during an agent run).
    this.showPopover?.();

    const webContents = this.getPopoverWebContents();

    if (webContents === null || webContents.isDestroyed()) {
      return Promise.resolve("deny");
    }

    const approvalId = randomUUID();

    return new Promise((resolve) => {
      this.pendingApprovals.set(approvalId, { runId: request.runId, resolve });
      webContents.send(IPC_CHANNELS.agentApprovalRequest, {
        approvalId,
        runId: request.runId,
        description: request.description
      });
    });
  }

  private setActiveRun(runId: string | null): void {
    this.currentRunId = runId;
    const webContents = this.getPopoverWebContents();

    if (webContents !== null && !webContents.isDestroyed()) {
      webContents.send(IPC_CHANNELS.agentRunState, { runId });
    }
  }

  private forwardRunActivity(activity: RunActivityEvent): void {
    const webContents = this.getPopoverWebContents();

    if (webContents !== null && !webContents.isDestroyed()) {
      webContents.send(IPC_CHANNELS.agentRunActivity, activity);
    }
  }
}
