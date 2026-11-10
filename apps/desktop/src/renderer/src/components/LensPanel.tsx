import { AppWindow, Camera, LoaderCircle, ScanSearch, Send, TextCursorInput } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { mauz } from "@renderer/lib/mauzClient";
import { detectLensObject } from "@renderer/lib/lensObject";
import { CaptureDetails } from "./CaptureDetails";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { FormattedAnswer } from "./FormattedAnswer";
import { PanelHeader } from "./PanelHeader";

const DEFAULT_QUESTION = "What is this, and what should I know about it?";

type AskState =
  | { status: "idle" }
  | { status: "loading"; partial: string | null }
  | { status: "answered"; answer: string }
  | { status: "failed"; message: string };

export function LensPanel(): React.JSX.Element {
  const { currentContext, dictation, setDictation } = useMauzStore();

  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [question, setQuestion] = useState("");
  // Local to this panel, so an answer that arrives after the panel closed has nowhere to go.
  const [ask, setAsk] = useState<AskState>({ status: "idle" });
  const askRequestIdRef = useRef<string | null>(null);

  useEffect(() => {
    return mauz().ask.onDelta(({ requestId, text }) => {
      if (requestId === askRequestIdRef.current) {
        setAsk((current) => (current.status === "loading" ? { status: "loading", partial: text } : current));
      }
    });
  }, []);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    await submitQuestion(question);
  };

  const submitQuestion = async (typedQuestion: string): Promise<void> => {
    if (currentContext === null) {
      setAsk({ status: "failed", message: "Mauz does not have cursor context yet." });
      return;
    }

    const prompt = typedQuestion.trim() || DEFAULT_QUESTION;
    const requestId = crypto.randomUUID();

    askRequestIdRef.current = requestId;
    setAsk({ status: "loading", partial: null });

    try {
      const response = await mauz().ask.submit({
        question: prompt,
        context: currentContext,
        requestId
      });

      if (askRequestIdRef.current !== requestId) {
        return;
      }

      setAsk({ status: "answered", answer: response.answer });
      setQuestion("");
    } catch (error) {
      if (askRequestIdRef.current === requestId) {
        setAsk({ status: "failed", message: error instanceof Error ? error.message : "Ask failed." });
      }
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

  const askLoading = ask.status === "loading";

  return (
    <section className="lens-panel lens-task-panel" aria-label="Ask">
      <PanelHeader title="Ask" subtitle={lensObject.label} />

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

      <div className="answer-area lens-answer-area" aria-live="polite" aria-busy={askLoading}>
        {ask.status === "failed" ? <p className="ask-error">{ask.message}</p> : null}
        {ask.status === "loading" && ask.partial !== null ? <FormattedAnswer answer={ask.partial} /> : null}
        {ask.status === "answered" ? <FormattedAnswer answer={ask.answer} /> : null}
        {ask.status === "idle" ? (
          <p className="ask-empty">
            Ask anything about what is under the pointer or selected. Press Ask with nothing typed to learn
            what this is.
          </p>
        ) : null}
      </div>
    </section>
  );
}
