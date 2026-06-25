import {
  AppWindow,
  ArrowLeft,
  Camera,
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

const LENS_ACTIONS: Array<{
  action: LensAction;
  label: string;
  detail: string;
  icon: typeof ScanSearch;
}> = [
  {
    action: "ask",
    label: "Ask",
    detail: "Open prompt",
    icon: ScanSearch
  },
  {
    action: "explain",
    label: "Explain",
    detail: "Plain read",
    icon: Sparkles
  },
  {
    action: "transform",
    label: "Transform",
    detail: "Make useful",
    icon: Wand2
  },
  {
    action: "remember",
    label: "Remember",
    detail: "Pin as this",
    icon: Pin
  },
  {
    action: "compare",
    label: "Compare",
    detail: "Use this/that",
    icon: GitCompareArrows
  }
];

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
    setPinnedLensObject,
    setSelectedLensAction
  } = useMauzStore();
  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [question, setQuestion] = useState("");

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleAction = (action: LensAction): void => {
    setSelectedLensAction(action);
    setAskError(null);

    if (action === "remember") {
      setPinnedLensObject(toLensMemory(lensObject));
      setAskAnswer(null);
      setAskConversationTitle(null);
      return;
    }

    if (action === "compare" && pinnedLensObject === null) {
      setAskError("Point at something, remember it, then compare another object with it.");
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (currentContext === null) {
      setAskError("Mauz Lens does not have cursor context yet.");
      return;
    }

    if (selectedLensAction === "remember") {
      setPinnedLensObject(toLensMemory(lensObject));
      setAskError(null);
      setAskAnswer(null);
      setAskConversationTitle(null);
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
    <section className="lens-panel" aria-label="Mauz Lens">
      <header className="lens-header">
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
            <h1>Mauz Lens</h1>
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

      <section className="lens-object" aria-label="Detected cursor object">
        <div className="lens-object-topline">
          <span>
            <MousePointer2 aria-hidden="true" size={13} />
            {formatLensType(lensObject.type)}
          </span>
          <span>{lensObject.confidence}%</span>
        </div>
        <h2>{lensObject.label}</h2>
        <p>{lensObject.summary}</p>
      </section>

      <div className="lens-memory-row" data-empty={pinnedLensObject === null}>
        <Pin aria-hidden="true" size={13} />
        <span>
          {pinnedLensObject === null ? "Nothing pinned as this." : `This: ${pinnedLensObject.label}`}
        </span>
        {pinnedLensObject !== null ? (
          <button type="button" onClick={() => setPinnedLensObject(null)}>
            Clear
          </button>
        ) : null}
      </div>

      <div className="context-strip lens-context-strip" aria-label="Lens context status">
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

      <div className="lens-actions" aria-label="Lens actions">
        {LENS_ACTIONS.map((item) => {
          const Icon = item.icon;

          return (
            <button
              key={item.action}
              type="button"
              aria-pressed={selectedLensAction === item.action}
              disabled={askLoading}
              onClick={() => handleAction(item.action)}
            >
              <Icon aria-hidden="true" size={15} />
              <span>{item.label}</span>
              <small>{item.detail}</small>
            </button>
          );
        })}
      </div>

      <form className="lens-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Question for Mauz Lens"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={getLensPlaceholder(selectedLensAction)}
          disabled={askLoading}
        />
        <button className="submit-button" type="submit" disabled={askLoading}>
          {askLoading ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{getSubmitLabel(selectedLensAction, askLoading)}</span>
        </button>
      </form>

      <div className="answer-area lens-answer-area" aria-live="polite">
        {askError !== null ? <p className="ask-error">{askError}</p> : null}
        {askAnswer !== null ? (
          <>
            {askConversationTitle !== null ? (
              <p className="saved-chat-title">Saved as "{askConversationTitle}"</p>
            ) : null}
            <FormattedAnswer answer={askAnswer} />
          </>
        ) : null}
        {askError === null && askAnswer === null ? (
          <p className="ask-empty">
            Choose an action, type only if needed, and let Lens work from the object under your cursor.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function formatLensType(type: string): string {
  return type.replace("-", " ");
}

function getLensPlaceholder(action: LensAction): string {
  if (action === "explain") {
    return "Optional: explain it for a specific goal";
  }

  if (action === "transform") {
    return "Optional: say how to transform this";
  }

  if (action === "compare") {
    return "Optional: add what to compare";
  }

  if (action === "remember") {
    return "Press Pin to remember this object";
  }

  return "Ask about this object";
}

function getSubmitLabel(action: LensAction, loading: boolean): string {
  if (loading) {
    return "Working";
  }

  if (action === "remember") {
    return "Pin this";
  }

  if (action === "compare") {
    return "Compare";
  }

  if (action === "transform") {
    return "Transform";
  }

  if (action === "explain") {
    return "Explain";
  }

  return "Ask";
}
