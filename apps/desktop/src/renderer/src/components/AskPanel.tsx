import {
  AppWindow,
  ArrowLeft,
  Camera,
  LoaderCircle,
  MousePointer2,
  Send,
  TextCursorInput,
  X
} from "lucide-react";
import { useState } from "react";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";

const QUICK_PROMPTS = ["What is this?", "Explain this", "What should I do here?", "Summarize this"];

export function AskPanel(): React.JSX.Element {
  const {
    currentContext,
    askAnswer,
    askError,
    askLoading,
    backToMenu,
    setAskAnswer,
    setAskError,
    setAskLoading
  } = useMauzStore();
  const [question, setQuestion] = useState("");

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (currentContext === null) {
      setAskError("Mauz does not have screen context yet.");
      return;
    }

    const trimmedQuestion = question.trim();

    if (trimmedQuestion.length === 0) {
      setAskError("Ask Mauz a question first.");
      return;
    }

    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);

    try {
      const response = await mauzClient.submitAsk({
        question: trimmedQuestion,
        context: currentContext
      });

      setAskAnswer(response.answer);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Ask Mauz failed.");
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <section className="ask-panel" aria-label="Ask Mauz">
      <header className="ask-header">
        <button
          className="icon-button"
          type="button"
          aria-label="Back to Mauz menu"
          onClick={() => void handleBack()}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <div>
          <h1>Ask Mauz</h1>
          <p>{currentContext === null ? "No context captured." : "Mauz is looking near your cursor."}</p>
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

      <div className="context-strip" aria-label="Context status">
        <span>
          <MousePointer2 aria-hidden="true" size={14} />
          {formatCursorCropStatus(currentContext)}
        </span>
        <span>
          <Camera aria-hidden="true" size={14} />
          {formatScreenshotStatus(currentContext)}
        </span>
        <span>
          <TextCursorInput aria-hidden="true" size={14} />
          {currentContext?.selectedText?.trim() ? "Selected text found" : "No selected text"}
        </span>
        <span>
          <AppWindow aria-hidden="true" size={14} />
          {currentContext?.activeWindow !== undefined || currentContext?.activeApp !== undefined
            ? "Window detected"
            : "No window"}
        </span>
      </div>

      {currentContext?.screenshotError !== undefined ? (
        <div className="permission-note" role="status">
          <strong>{currentContext.screenshotError.message}</strong>
          {currentContext.screenshotError.permission === "screen-recording" ? (
            <span>Open System Settings, then Privacy &amp; Security, then Screen Recording.</span>
          ) : (
            <span>You can still ask a text-only question.</span>
          )}
        </div>
      ) : null}

      <div className="quick-prompts" aria-label="Quick prompts">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" disabled={askLoading} onClick={() => setQuestion(prompt)}>
            {prompt}
          </button>
        ))}
      </div>

      <form className="ask-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Question for Mauz"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What am I looking at?"
          disabled={askLoading}
        />
        <button className="submit-button" type="submit" disabled={askLoading}>
          {askLoading ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{askLoading ? "Asking" : "Ask"}</span>
        </button>
      </form>

      <div className="answer-area" aria-live="polite">
        {askError !== null ? <p className="ask-error">{askError}</p> : null}
        {askAnswer !== null ? <p className="ask-answer">{askAnswer}</p> : null}
        {askError === null && askAnswer === null ? (
          <p className="ask-empty">Ask about the area around your cursor.</p>
        ) : null}
      </div>
    </section>
  );
}

function formatCursorCropStatus(context: ReturnType<typeof useMauzStore.getState>["currentContext"]): string {
  if (context?.pointer?.cursorCrop !== undefined) {
    return "Cursor area attached";
  }

  if (context?.screenshotError !== undefined) {
    return "No cursor area";
  }

  return "Cursor area pending";
}

function formatScreenshotStatus(context: ReturnType<typeof useMauzStore.getState>["currentContext"]): string {
  const screenshot = context?.pointer?.screenshot ?? context?.screenshot;

  if (screenshot !== undefined) {
    return "Screenshot attached";
  }

  if (context?.screenshotError !== undefined) {
    return context.screenshotError.permission === "screen-recording"
      ? "Screen permission needed"
      : "No screenshot";
  }

  return "No screenshot";
}
