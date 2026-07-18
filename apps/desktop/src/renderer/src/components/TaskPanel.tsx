import {
  AppWindow,
  ArrowLeft,
  BriefcaseBusiness,
  Camera,
  LoaderCircle,
  MousePointer2,
  Send,
  ShieldAlert,
  Square,
  TextCursorInput,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentApprovalPayload, AgentRunActivityPayload, GatewayReadinessResult } from "@mauzai/shared";
import { classifyApprovalRisk } from "@renderer/lib/approvalRisk";
import { buildTaskPrompt, canSubmitTask } from "@renderer/lib/taskPrompt";
import { detectLensObject } from "@renderer/lib/lensObject";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";
import { FormattedAnswer } from "./FormattedAnswer";

type ReadinessState = GatewayReadinessResult | { status: "loading"; message: string };
type ActivityEntry = AgentRunActivityPayload & { seq: number };

export function TaskPanel(): React.JSX.Element {
  const {
    currentContext,
    askAnswer,
    askConversationTitle,
    askError,
    askLoading,
    backToMenu,
    setAskAnswer,
    setAskConversationTitle,
    setAskError,
    setAskLoading
  } = useMauzStore();
  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [outcome, setOutcome] = useState("");
  const [readiness, setReadiness] = useState<ReadinessState>({
    status: "loading",
    message: "Checking gateway readiness…"
  });
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [approvalRequest, setApprovalRequest] = useState<AgentApprovalPayload | null>(null);
  const [runActivities, setRunActivities] = useState<ActivityEntry[]>([]);
  const [activityExpanded, setActivityExpanded] = useState(false);
  const activeRunIdRef = useRef<string | null>(null);
  const activitySequenceRef = useRef(0);

  useEffect(() => {
    let disposed = false;

    void mauzClient.getGatewayReadinessStatus().then(
      (result) => {
        if (!disposed) setReadiness(result);
      },
      () => {
        if (!disposed) {
          setReadiness({ status: "unavailable", message: "Gateway readiness could not be checked." });
        }
      }
    );

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const unsubscribeApproval = mauzClient.onAgentApprovalRequest((payload) => {
      if (payload.runId === activeRunIdRef.current) setApprovalRequest(payload);
    });
    const unsubscribeRunState = mauzClient.onAgentRunState(({ runId }) => {
      activeRunIdRef.current = runId;
      setActiveRunId(runId);
      setApprovalRequest(null);
      setRunActivities([]);
      setActivityExpanded(false);
    });
    const unsubscribeActivity = mauzClient.onAgentRunActivity((payload) => {
      setRunActivities((activities) => {
        const next = [...activities, { ...payload, seq: activitySequenceRef.current++ }];
        return next.length > 50 ? next.slice(-50) : next;
      });
    });

    return () => {
      unsubscribeApproval();
      unsubscribeRunState();
      unsubscribeActivity();
    };
  }, []);

  const handleApprovalChoice = (choice: "once" | "session" | "always" | "deny"): void => {
    if (approvalRequest === null) return;
    void mauzClient.respondAgentApproval({ approvalId: approvalRequest.approvalId, choice });
    setApprovalRequest(null);
  };

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (currentContext === null) {
      setAskError("Mauz does not have cursor context yet.");
      return;
    }

    let currentReadiness: GatewayReadinessResult;

    try {
      currentReadiness = await mauzClient.getGatewayReadinessStatus();
    } catch {
      currentReadiness = { status: "unavailable", message: "Gateway readiness could not be checked." };
    }

    setReadiness(currentReadiness);

    if (currentReadiness.status !== "ready") {
      setAskError(currentReadiness.message);
      return;
    }

    try {
      const prompt = buildTaskPrompt(outcome);
      setAskLoading(true);
      setAskError(null);
      setAskAnswer(null);
      setAskConversationTitle(null);
      const response = await mauzClient.submitAsk({ question: prompt, context: currentContext });
      setAskAnswer(response.answer);
      setAskConversationTitle(response.conversationTitle ?? null);
      setOutcome("");
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Mauz task failed.");
    } finally {
      setAskLoading(false);
    }
  };

  const canSubmit = canSubmitTask(
    outcome,
    readiness.status === "loading" ? "unavailable" : readiness.status,
    askLoading
  );

  return (
    <section className="lens-panel lens-task-panel task-panel" aria-label="Work on this">
      <header className="lens-header lens-task-header">
        <button
          className="icon-button"
          type="button"
          aria-label="Back to Mauz menu"
          onClick={() => void handleBack()}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <div className="panel-title">
          <BrandLogo className="panel-title-logo" />
          <div>
            <h1 tabIndex={-1}>Work on this</h1>
            <p>Supervised task</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => void mauzClient.close()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <section className="lens-task-summary" aria-label="Selected cursor context">
        <div className="lens-task-summary-icon">
          <BriefcaseBusiness aria-hidden="true" size={17} />
        </div>
        <div>
          <div className="lens-task-eyebrow">
            <span>Selected scope</span>
            <span>{lensObject.confidence}%</span>
          </div>
          <h2>{lensObject.label}</h2>
          <p>{lensObject.summary}</p>
        </div>
      </section>

      <div className="lens-task-context" aria-label="Task context scope">
        <span>
          <Camera aria-hidden="true" size={14} />
          {lensObject.privacyMode}
        </span>
        <span>
          <TextCursorInput aria-hidden="true" size={14} />
          {currentContext?.selectedText?.trim() ? "Text selected" : "No selected text"}
        </span>
        <span>
          <AppWindow aria-hidden="true" size={14} />
          {currentContext?.activeWindow !== undefined || currentContext?.activeApp !== undefined
            ? "Window aware"
            : "No window"}
        </span>
        <span>
          <MousePointer2 aria-hidden="true" size={14} />
          Approval required for mutations
        </span>
      </div>

      <p className="task-readiness" data-status={readiness.status} role="status">
        <strong>Gateway: {readiness.status === "loading" ? "checking" : readiness.status}</strong>
        <span>{readiness.message}</span>
      </p>

      <form className="lens-task-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Desired outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          placeholder="Describe the outcome you want"
          disabled={askLoading}
        />
        <button className="submit-button" type="submit" disabled={!canSubmit}>
          {askLoading ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{askLoading ? "Working" : "Start work"}</span>
        </button>
      </form>

      {activeRunId !== null ? (
        <>
          <button type="button" className="agent-stop-button" onClick={() => void mauzClient.stopAgentRun()}>
            <Square aria-hidden="true" size={12} /> Stop
          </button>
          <div className="agent-activity">
            <span className="agent-activity-dot" aria-hidden="true" />
            <span className="agent-activity-label">{runActivities.at(-1)?.label ?? "Working…"}</span>
            {runActivities.length > 0 ? (
              <button
                type="button"
                className="agent-activity-count"
                aria-expanded={activityExpanded}
                onClick={() => setActivityExpanded((value) => !value)}
              >
                {runActivities.length} {runActivities.length === 1 ? "step" : "steps"}
              </button>
            ) : null}
            {activityExpanded ? (
              <ul className="agent-activity-list" aria-label="Activity history">
                {runActivities.map((activity) => (
                  <li key={activity.seq}>{activity.label}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}

      <div
        className="answer-area lens-answer-area"
        data-empty={askError === null && askAnswer === null}
        aria-live="polite"
        aria-busy={askLoading}
      >
        {approvalRequest !== null ? (
          <ApprovalCard description={approvalRequest.description} onChoice={handleApprovalChoice} />
        ) : null}
        {askError !== null ? <p className="ask-error">{askError}</p> : null}
        {askAnswer !== null ? (
          <>
            {askConversationTitle !== null ? (
              <p className="saved-chat-title">Saved as "{askConversationTitle}"</p>
            ) : null}
            <FormattedAnswer answer={askAnswer} />
          </>
        ) : null}
        {askError === null && askAnswer === null && !askLoading ? (
          <p className="ask-empty">Describe one outcome to start a supervised task.</p>
        ) : null}
      </div>
    </section>
  );
}

type ApprovalCardProps = {
  description: string;
  onChoice: (choice: "once" | "session" | "always" | "deny") => void;
};

function ApprovalCard({ description, onChoice }: ApprovalCardProps): React.JSX.Element {
  const risk = classifyApprovalRisk(description);

  return (
    <div className="agent-approval" role="alertdialog" aria-label="Agent approval request" data-risk={risk}>
      <p className="agent-approval-description">
        <ShieldAlert aria-hidden="true" size={14} />
        {description}
      </p>
      <div className="agent-approval-primary">
        <button type="button" className="agent-approval-allow" onClick={() => onChoice("once")}>
          Allow once
        </button>
        <button type="button" className="agent-approval-deny" onClick={() => onChoice("deny")}>
          Deny
        </button>
      </div>
      <button type="button" className="agent-approval-secondary" onClick={() => onChoice("session")}>
        Allow for session
      </button>
      <button type="button" className="agent-approval-tertiary" onClick={() => onChoice("always")}>
        Always allow <small>won&apos;t ask again</small>
      </button>
    </div>
  );
}
