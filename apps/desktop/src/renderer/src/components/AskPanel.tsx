import { useEffect, useRef, useState } from "react";
import { mauz } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { FormattedAnswer } from "./FormattedAnswer";
import { goBackToMenu } from "./PanelHeader";

const DEFAULT_QUESTION = "What is this, and what should I know about it?";

type AskState =
  | { status: "idle" }
  | { status: "loading"; partial: string | null }
  | { status: "answered"; answer: string }
  | { status: "failed"; message: string };

/** Two boxes: the question, and the answer as it streams in. Enter asks; Escape goes back. */
export function AskPanel(): React.JSX.Element {
  const { currentContext, dictation, setDictation } = useMauzStore();
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

  const submitQuestion = async (typedQuestion: string): Promise<void> => {
    if (currentContext === null) {
      setAsk({ status: "failed", message: "Mauz does not have cursor context yet." });
      return;
    }

    const requestId = crypto.randomUUID();
    askRequestIdRef.current = requestId;
    setAsk({ status: "loading", partial: null });

    try {
      const response = await mauz().ask.submit({
        question: typedQuestion.trim() || DEFAULT_QUESTION,
        context: currentContext,
        requestId
      });

      if (askRequestIdRef.current === requestId) {
        setAsk({ status: "answered", answer: response.answer });
      }
    } catch (error) {
      if (askRequestIdRef.current === requestId) {
        setAsk({ status: "failed", message: error instanceof Error ? error.message : "Ask failed." });
      }
    }
  };

  // Dictated text is shown in the question box and asked right away.
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape") {
      void goBackToMenu();
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!askLoading) {
        void submitQuestion(question);
      }
    }
  };

  return (
    <section className="mode-panel" aria-label="Ask">
      <div className="mode-form ask-form">
        <textarea
          aria-label="Question for Mauz"
          autoFocus
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about what's under the pointer, then press Enter"
          readOnly={askLoading}
        />
      </div>

      <div className="answer-area ask-answer-area" aria-live="polite" aria-busy={askLoading}>
        {ask.status === "failed" ? <p className="ask-error">{ask.message}</p> : null}
        {ask.status === "loading" ? (
          ask.partial === null ? (
            <p className="ask-empty">Thinking...</p>
          ) : (
            <FormattedAnswer answer={ask.partial} />
          )
        ) : null}
        {ask.status === "answered" ? <FormattedAnswer answer={ask.answer} /> : null}
      </div>
    </section>
  );
}
