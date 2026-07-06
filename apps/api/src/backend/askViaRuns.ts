import type { AskMauzRequest, AskMauzResponse } from "@mauzai/shared";
import { MAUZ_SYSTEM_PROMPT } from "../prompts/mauzSystemPrompt";
import { buildResponseContent } from "../openai/askMauz";
import { AgentRunStoppedError, AgentRunUnwatchableError } from "../errors";
import { getRunStatus, resolveRunApproval, startRun, stopRun, streamRunEvents } from "./runsClient";

const APPROVAL_TIMEOUT_MS = 180_000;
const POLL_RETRY_DELAY_MS = 2_000;
// The gateway destroys a run's SSE queue when the connection drops, so we cannot
// reconnect to /events — status polling is the only recovery path. Keep the
// window generous: a healthy run may need minutes to finish after a drop.
const MAX_POLL_RETRIES = 90;

export type AgentApprovalChoice = "once" | "session" | "always" | "deny";

export type AgentApprovalRequest = {
  runId: string;
  description: string;
  raw: Record<string, unknown>;
};

export type ApprovalRequestHandler = (request: AgentApprovalRequest) => Promise<AgentApprovalChoice>;

export type RunActivityEvent = {
  runId: string;
  kind: "tool.started" | "tool.completed" | "reasoning";
  tool?: string;
  label: string;
};

export type RunLifecycleHooks = {
  onApprovalRequest?: ApprovalRequestHandler;
  onRunStarted?: (run: { runId: string }) => void;
  onRunFinished?: (run: { runId: string }) => void;
  onRunActivity?: (activity: RunActivityEvent) => void;
};

export type AskViaRunsOptions = RunLifecycleHooks & {
  baseUrl: string;
  model: string;
  agentMode: "approve" | "yolo";
  apiKey?: string;
  installId?: string;
  fetchImpl?: typeof fetch;
  sessionKeyHeader?: string;
  timeouts?: {
    approvalMs?: number;
    streamIdleMs?: number;
    requestMs?: number;
  };
  pollRetries?: {
    max?: number;
    delayMs?: number;
  };
};

export async function askViaRuns(
  request: AskMauzRequest,
  options: AskViaRunsOptions
): Promise<AskMauzResponse> {
  const clientOptions = {
    baseUrl: options.baseUrl,
    ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.sessionKeyHeader === undefined ? {} : { sessionKeyHeader: options.sessionKeyHeader }),
    ...(options.timeouts?.requestMs !== undefined || options.timeouts?.streamIdleMs !== undefined
      ? {
          timeouts: {
            ...(options.timeouts.requestMs !== undefined ? { requestMs: options.timeouts.requestMs } : {}),
            ...(options.timeouts.streamIdleMs !== undefined ? { streamIdleMs: options.timeouts.streamIdleMs } : {})
          }
        }
      : {})
  };
  const { runId } = await startRun({
    ...clientOptions,
    input: [{ role: "user", content: buildResponseContent(request) }],
    instructions: MAUZ_SYSTEM_PROMPT,
    ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
    ...(options.apiKey !== undefined && options.installId !== undefined
      ? { sessionKey: options.installId }
      : {})
  });

  options.onRunStarted?.({ runId });

  try {
    try {
      for await (const event of streamRunEvents({ ...clientOptions, runId })) {
        if (event.event === "tool.started") {
          const tool = typeof event.tool === "string" ? event.tool : "tool";
          const preview = typeof event.preview === "string" && event.preview.length > 0 ? ` — ${event.preview}` : "";
          try { options.onRunActivity?.({ runId, kind: "tool.started", tool, label: `${tool}${preview}` }); } catch { /* hooks must not kill the run */ }
          continue;
        }

        if (event.event === "tool.completed") {
          const tool = typeof event.tool === "string" ? event.tool : "tool";
          const failed = event.error !== undefined;
          try { options.onRunActivity?.({ runId, kind: "tool.completed", tool, label: `${tool} ${failed ? "failed" : "done"}` }); } catch { /* hooks must not kill the run */ }
          continue;
        }

        if (event.event === "reasoning.available") {
          const raw = typeof event.reasoning === "string" ? event.reasoning : "";
          const text = raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
          try { options.onRunActivity?.({ runId, kind: "reasoning", label: text }); } catch { /* hooks must not kill the run */ }
          continue;
        }

        if (event.event === "approval.request") {
          const choice =
            options.agentMode === "yolo"
              ? "session"
              : await approvalWithTimeout(
                  options.onApprovalRequest ?? denyByDefault,
                  {
                    runId,
                    description: typeof event.description === "string" ? event.description : "Agent action",
                    raw: event
                  },
                  options.timeouts?.approvalMs ?? APPROVAL_TIMEOUT_MS
                );

          await resolveRunApproval({ ...clientOptions, runId, choice });
          continue;
        }

        if (event.event === "run.completed") {
          const answer = typeof event.output === "string" ? event.output.trim() : "";

          if (answer.length === 0) {
            throw new Error("Agent run completed without a text answer.");
          }

          return {
            answer,
            model: options.model,
            ...(event.usage === undefined ? {} : { usage: event.usage })
          };
        }

        if (event.event === "run.failed") {
          throw new Error(typeof event.error === "string" ? event.error : "Agent run failed.");
        }

        if (event.event === "run.cancelled") {
          throw new AgentRunStoppedError();
        }
      }

      // SSE stream dropped: poll status with bounded retry
      const maxPolls = options.pollRetries?.max ?? MAX_POLL_RETRIES;
      const pollDelay = options.pollRetries?.delayMs ?? POLL_RETRY_DELAY_MS;
      let runStillAlive = false;

      for (let attempt = 0; attempt < maxPolls; attempt++) {
        if (attempt > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, pollDelay));
        }

        const status = await getRunStatus({ ...clientOptions, runId });

        if (status?.status === "completed") {
          const answer = typeof status.output === "string" ? status.output.trim() : "";

          if (answer.length === 0) {
            throw new Error("Agent run completed without a text answer.");
          }

          return {
            answer,
            model: options.model,
            ...(status.usage === undefined ? {} : { usage: status.usage })
          };
        }

        if (status?.status === "failed") {
          throw new Error(typeof status.error === "string" ? status.error : "Agent run failed.");
        }

        if (status?.status === "cancelled") {
          throw new AgentRunStoppedError();
        }

        runStillAlive = status !== null;
      }

      if (runStillAlive) {
        // The run is progressing server-side; its work (and memory) still lands
        // even though we can no longer watch it. Don't kill it.
        throw new AgentRunUnwatchableError();
      }

      throw new Error("Lost connection to the agent run before it completed.");
    } catch (error) {
      // Best-effort stop for failures; skip for cancellation (run already done
      // server-side) and for still-alive runs we merely lost sight of.
      if (!(error instanceof AgentRunStoppedError) && !(error instanceof AgentRunUnwatchableError)) {
        try { await stopRun({ ...clientOptions, runId }); } catch { /* best-effort, ignore */ }
      }
      throw error;
    }
  } finally {
    options.onRunFinished?.({ runId });
  }
}

async function approvalWithTimeout(
  handler: ApprovalRequestHandler,
  approvalRequest: AgentApprovalRequest,
  timeoutMs: number
): Promise<AgentApprovalChoice> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      handler(approvalRequest).catch((): AgentApprovalChoice => "deny"),
      new Promise<AgentApprovalChoice>((resolve) => {
        timeoutId = setTimeout(() => resolve("deny"), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function denyByDefault(): Promise<AgentApprovalChoice> {
  return "deny";
}
