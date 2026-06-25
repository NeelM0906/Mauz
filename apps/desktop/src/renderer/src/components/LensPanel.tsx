import {
  AppWindow,
  ArrowLeft,
  Camera,
  Check,
  GitCompareArrows,
  LoaderCircle,
  MousePointer2,
  Pin,
  ScanSearch,
  Send,
  Sparkles,
  TextCursorInput,
  Wand2,
  X
} from "lucide-react";
import { useMemo, useState } from "react";
import type { LensAction } from "@renderer/state/useMauzStore";
import { mauzClient } from "@renderer/lib/mauzClient";
import { detectLensObject, getLensActionQuestion, toLensMemory } from "@renderer/lib/lensObject";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";
import { FormattedAnswer } from "./FormattedAnswer";

const ACTION_UI: Record<
  LensAction,
  {
    title: string;
    subtitle: string;
    buttonLabel: string;
    placeholder: string;
    emptyState: string;
    icon: typeof ScanSearch;
  }
> = {
  ask: {
    title: "Ask Mauz",
    subtitle: "Cursor prompt",
    buttonLabel: "Ask",
    placeholder: "Ask about this object",
    emptyState: "Ask anything about what is under the cursor. The response stays in this popup.",
    icon: ScanSearch
  },
  explain: {
    title: "Explain",
    subtitle: "Plain read",
    buttonLabel: "Explain",
    placeholder: "Optional: explain it for a specific goal",
    emptyState: "Press Explain for a clear read of the current cursor context.",
    icon: Sparkles
  },
  transform: {
    title: "Transform",
    subtitle: "Make useful",
    buttonLabel: "Transform",
    placeholder: "Optional: say how to transform this",
    emptyState: "Press Transform to turn the current object into a useful next-step output.",
    icon: Wand2
  },
  remember: {
    title: "Remember",
    subtitle: "Pin as this",
    buttonLabel: "Pin",
    placeholder: "Pin this cursor object",
    emptyState: "This object is pinned for Compare until you clear or replace it.",
    icon: Pin
  },
  compare: {
    title: "Compare",
    subtitle: "Use this and that",
    buttonLabel: "Compare",
    placeholder: "Optional: add what to compare",
    emptyState:
      "Compare the current cursor object with the pinned object. Pin something first for a stronger comparison.",
    icon: GitCompareArrows
  }
};

export function LensPanel(): React.JSX.Element {
  const {
    currentContext,
    selectedLensAction,
    pinnedLensObject,
    askAnswer,
    askConversationTitle,
    askError,
    askLoading,
    backToMenu,
    setAskAnswer,
    setAskConversationTitle,
    setAskError,
    setAskLoading,
    setPinnedLensObject
  } = useMauzStore();
  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [question, setQuestion] = useState("");
  const action = ACTION_UI[selectedLensAction];
  const ActionIcon = action.icon;
  const isRemembering = selectedLensAction === "remember";

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handlePin = (): void => {
    setPinnedLensObject(toLensMemory(lensObject));
    setAskError(null);
    setAskAnswer(null);
    setAskConversationTitle(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (currentContext === null) {
      setAskError("Mauz Lens does not have cursor context yet.");
      return;
    }

    if (isRemembering) {
      handlePin();
      return;
    }

    const prompt = getLensActionQuestion(selectedLensAction, lensObject, pinnedLensObject, question);

    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);
    setAskConversationTitle(null);

    try {
      const response = await mauzClient.submitAsk({
        question: prompt,
        context: currentContext
      });

      setAskAnswer(response.answer);
      setAskConversationTitle(response.conversationTitle ?? null);
      setQuestion("");
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Mauz Lens failed.");
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <section className="lens-panel lens-task-panel" aria-label={action.title}>
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
            <h1>{action.title}</h1>
            <p>{lensObject.label}</p>
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

      <section className="lens-task-summary" aria-label="Current cursor context">
        <div className="lens-task-summary-icon">
          <ActionIcon aria-hidden="true" size={17} />
        </div>
        <div>
          <div className="lens-task-eyebrow">
            <span>{action.subtitle}</span>
            <span>{lensObject.confidence}%</span>
          </div>
          <h2>{lensObject.label}</h2>
          <p>{lensObject.summary}</p>
        </div>
      </section>

      <div className="lens-task-context" aria-label="Lens context status">
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
          No autonomous actions
        </span>
      </div>

      {currentContext?.screenshotError !== undefined ? (
        <div className="permission-note" role="status">
          <strong>{currentContext.screenshotError.message}</strong>
          <span>You can still use Lens with selected text, window metadata, or a typed prompt.</span>
        </div>
      ) : null}

      {isRemembering ? (
        <div className="lens-remember-card" role="status">
          <Check aria-hidden="true" size={17} />
          <div>
            <strong>Remembered as this.</strong>
            <span>{pinnedLensObject?.label ?? lensObject.label}</span>
          </div>
          <button type="button" onClick={handlePin}>
            Refresh pin
          </button>
        </div>
      ) : null}

      <form className="lens-task-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Question for Mauz Lens"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={action.placeholder}
          disabled={askLoading || isRemembering}
        />
        <button className="submit-button" type="submit" disabled={askLoading}>
          {askLoading ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : isRemembering ? (
            <Pin aria-hidden="true" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{askLoading ? "Working" : action.buttonLabel}</span>
        </button>
      </form>

      <div
        className="answer-area lens-answer-area"
        data-empty={askError === null && askAnswer === null}
        aria-live="polite"
      >
        {askError !== null ? <p className="ask-error">{askError}</p> : null}
        {askAnswer !== null ? (
          <>
            {askConversationTitle !== null ? (
              <p className="saved-chat-title">Saved as "{askConversationTitle}"</p>
            ) : null}
            <FormattedAnswer answer={askAnswer} />
          </>
        ) : null}
        {askError === null && askAnswer === null ? <p className="ask-empty">{action.emptyState}</p> : null}
      </div>
    </section>
  );
}
