import {
  AppWindow,
  ArrowLeft,
  Camera,
  LoaderCircle,
  ScanSearch,
  Send,
  TextCursorInput,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { mauzClient } from "@renderer/lib/mauzClient";
import { detectLensObject } from "@renderer/lib/lensObject";
import { CaptureDetails } from "./CaptureDetails";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";
import { FormattedAnswer } from "./FormattedAnswer";

const DEFAULT_QUESTION = "What is this, and what should I know about it?";

export function LensPanel(): React.JSX.Element {
  const {
    currentContext,
    askAnswer,
    askError,
    askLoading,
    backToMenu,
    setAskAnswer,
    setAskError,
    setAskLoading,
    dictation,
    setDictation
  } = useMauzStore();

  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [question, setQuestion] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState<string | null>(null);
  const askRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    return mauzClient.onAnswerDelta(({ requestId, text }) => {
      if (requestId === askRequestIdRef.current) {
        setStreamingAnswer(text);
      }
    });
  }, []);

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submitQuestion(question);
  };

  const submitQuestion = async (typedQuestion: string): Promise<void> => {
    if (currentContext === null) {
      setAskError("Mauz does not have cursor context yet.");
      return;
    }

    const prompt = typedQuestion.trim() || DEFAULT_QUESTION;
    const requestId = crypto.randomUUID();

    askRequestIdRef.current = requestId;
    setStreamingAnswer(null);
    setAskLoading(true);
    setAskError(null);
    setAskAnswer(null);

    try {
      const response = await mauzClient.submitAsk({
        question: prompt,
        context: currentContext,
        requestId
      });

      setAskAnswer(response.answer);
      setQuestion("");
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Ask failed.");
    } finally {
      askRequestIdRef.current = null;
      setStreamingAnswer(null);
      setAskLoading(false);
    }
  };

  // Dictated text is asked right away.
  const submitQuestionRef = useRef(submitQuestion);
  submitQuestionRef.current = submitQuestion;

  useEffect(() => {
    if (dictation === null) {
      return;
    }

    setDictation(null);
    setQuestion(dictation);
    void submitQuestionRef.current(dictation);
  }, [dictation, setDictation]);

  return (
    <section className="lens-panel lens-task-panel" aria-label="Ask">
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
            <h1 tabIndex={-1}>Ask</h1>
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
          <ScanSearch aria-hidden="true" size={17} />
        </div>
        <div>
          <div className="lens-task-eyebrow">
            <span>What's on screen</span>
            <span>{lensObject.confidence}%</span>
          </div>
          <h2>{lensObject.label}</h2>
          <p>{lensObject.summary}</p>
        </div>
      </section>

      <div className="lens-task-context" aria-label="Capture status">
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
      </div>

      <CaptureDetails context={currentContext} />

      {currentContext?.screenshotError !== undefined ? (
        <div className="permission-note" role="status">
          <strong>{currentContext.screenshotError.message}</strong>
          <span>You can still ask with selected text, window metadata, or a typed question.</span>
        </div>
      ) : null}

      <form className="lens-task-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Question for Mauz"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this (or just press Ask)"
          disabled={askLoading}
        />
        <button className="submit-button" type="submit" disabled={askLoading}>
          {askLoading ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{askLoading ? "Working" : "Ask"}</span>
        </button>
      </form>

      <div
        className="answer-area lens-answer-area"
        data-empty={askError === null && askAnswer === null}
        aria-live="polite"
        aria-busy={askLoading}
      >
        {askError !== null ? <p className="ask-error">{askError}</p> : null}
        {askLoading && askAnswer === null && streamingAnswer !== null ? (
          <FormattedAnswer answer={streamingAnswer} />
        ) : null}
        {askAnswer !== null ? <FormattedAnswer answer={askAnswer} /> : null}
        {askError === null && askAnswer === null && streamingAnswer === null && !askLoading ? (
          <p className="ask-empty">
            Ask anything about what is under the pointer or selected. Press Ask with nothing typed to learn
            what this is.
          </p>
        ) : null}
      </div>
    </section>
  );
}
