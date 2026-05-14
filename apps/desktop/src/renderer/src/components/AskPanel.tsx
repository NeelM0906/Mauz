import { ArrowLeft, Camera, LoaderCircle, Send, TextCursorInput, X } from "lucide-react";
import { useState } from "react";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";

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
          <p>{formatContextStatus(currentContext)}</p>
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
          <Camera aria-hidden="true" size={14} />
          {currentContext?.screenshot === undefined
            ? "No screenshot"
            : `${currentContext.screenshot.width}x${currentContext.screenshot.height}`}
        </span>
        <span>
          <TextCursorInput aria-hidden="true" size={14} />
          {currentContext?.selectedText?.trim() ? "Selected text found" : "No selected text"}
        </span>
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
          <p className="ask-empty">Mauz will answer using the screenshot captured when you opened Ask.</p>
        ) : null}
      </div>
    </section>
  );
}

function formatContextStatus(context: ReturnType<typeof useMauzStore.getState>["currentContext"]): string {
  if (context === null) {
    return "No context captured.";
  }

  return context.screenshot === undefined
    ? "Context captured without screenshot."
    : "Screenshot context captured.";
}
