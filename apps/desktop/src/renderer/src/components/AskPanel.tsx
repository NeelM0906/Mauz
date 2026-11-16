import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AskSessionRequest } from "@mauzai/shared";
import { mauz } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { FormattedAnswer } from "./FormattedAnswer";
import { PanelHeader } from "./PanelHeader";

type AttachmentChoice = Pick<AskSessionRequest, "sourceId" | "includeScreenshot" | "earlierImageId">;

export function AskPanel(): React.JSX.Element {
  const { askSession, askDraft, setAskDraft, setAskSession, askFocus, dictation, setDictation } =
    useMauzStore();
  const [error, setError] = useState<string | null>(null);
  const [excludedSource, setExcludedSource] = useState<string>();
  const [screenshotChoice, setScreenshotChoice] = useState<{ sourceId: string; include: boolean }>();
  const [earlierImageId, setEarlierImageId] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const submitting = useRef<string | null>(null);
  const lastSession = useRef<string | undefined>(undefined);
  const sessionId = askSession?.id;
  const source = askSession?.source;
  const shownSource = source?.id === excludedSource ? null : source;
  const busy = askSession?.pending != null;
  const canAskAboutSource = askSession?.turns.length === 0 && shownSource != null;
  const includeScreenshot =
    shownSource?.hasImage === true &&
    (screenshotChoice?.sourceId === shownSource.id ? screenshotChoice.include : shownSource.useImage);
  const shownEarlierImage = askSession?.turns.some(
    (turn) => turn.imageId === earlierImageId && earlierImageId !== undefined
  )
    ? earlierImageId
    : undefined;

  useEffect(() => {
    input.current?.focus();
  }, [askFocus, sessionId]);

  useLayoutEffect(() => {
    if (lastSession.current !== sessionId) {
      lastSession.current = sessionId;
      followBottom.current = true;
    }
    const area = transcript.current;
    if (area !== null && followBottom.current) area.scrollTop = area.scrollHeight;
  }, [askSession, sessionId, askFocus]);

  const submit = async (question: string, attachments: AttachmentChoice): Promise<void> => {
    if (askSession === null || busy || submitting.current === askSession.id) return;
    if (!question.trim() && !canAskAboutSource) return;
    submitting.current = askSession.id;
    setError(null);
    followBottom.current = true;
    setAskDraft("");
    setEarlierImageId(undefined);
    try {
      await mauz().ask.submit({
        sessionId: askSession.id,
        requestId: crypto.randomUUID(),
        question,
        ...attachments
      });
    } catch (failure) {
      const state = useMauzStore.getState();
      if (state.askSession?.id === askSession.id) {
        if (!state.askDraft) state.setAskDraft(question);
        setError(failure instanceof Error ? failure.message : "Ask failed. Try again.");
      }
    } finally {
      if (submitting.current === askSession.id) submitting.current = null;
    }
  };

  const readAttachments = (): AttachmentChoice => ({
    ...(shownSource == null ? {} : { sourceId: shownSource.id, includeScreenshot }),
    ...(shownEarlierImage === undefined ? {} : { earlierImageId: shownEarlierImage })
  });

  const submitRef = useRef(submit);
  const attachmentsRef = useRef(readAttachments);
  submitRef.current = submit;
  attachmentsRef.current = readAttachments;

  useEffect(() => {
    if (dictation === null || sessionId === undefined || busy) return;
    setDictation(null);
    void submitRef.current(dictation, attachmentsRef.current());
  }, [dictation, sessionId, busy, setDictation]);

  async function startNew(): Promise<void> {
    const current = useMauzStore.getState().askSession;
    setError(null);
    try {
      const next =
        current === null ? await mauz().ask.open() : await mauz().ask.newChat({ sessionId: current.id });
      const state = useMauzStore.getState();
      if (state.mode !== "ask" || state.askSession?.id !== current?.id) return;
      setAskSession(next);
      setExcludedSource(undefined);
      setScreenshotChoice(undefined);
      setEarlierImageId(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start a new chat.");
    }
  }

  const failure = askSession?.failure;
  const failureMessage = error ?? failure?.message;
  const retrySourceAvailable = failure?.sourceId === undefined || source?.id === failure.sourceId;
  const retryImageAvailable =
    failure?.earlierImageId === undefined ||
    askSession?.turns.some((turn) => turn.imageId === failure.earlierImageId);

  return (
    <section className="mode-panel ask-panel" aria-label="Ask">
      <PanelHeader
        title="Ask"
        subtitle="Mauz at your cursor"
        action={
          <button type="button" className="secondary-button ask-new" onClick={() => void startNew()}>
            New chat
          </button>
        }
      />

      <form
        className="mode-form ask-form ask-composer"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(askDraft, readAttachments());
        }}
      >
        <div className="ask-input-row">
          <textarea
            ref={input}
            className="resize-none"
            aria-label="Question for Mauz"
            value={askDraft}
            maxLength={4_000}
            onChange={(event) => setAskDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit(askDraft, readAttachments());
              }
            }}
            placeholder={askSession?.turns.length ? "Ask a follow-up" : "Ask Mauz"}
          />
          {busy && sessionId !== undefined ? (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                void mauz()
                  .ask.stop({ sessionId })
                  .catch(() => setError("Could not stop this answer."));
              }}
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="submit-button"
              disabled={askSession === null || (!askDraft.trim() && !canAskAboutSource)}
            >
              Ask
            </button>
          )}
        </div>
        {askSession?.notice ? (
          <p className="ask-empty" role="status">
            {askSession.notice}
          </p>
        ) : null}
        {failureMessage ? (
          <div className="ask-feedback">
            <p className="ask-error" role="alert">
              {failureMessage}
            </p>
            {failure != null && retrySourceAvailable && retryImageAvailable ? (
              <button
                type="button"
                className="secondary-button ask-small-button"
                onClick={() =>
                  void submit(failure.question, {
                    ...(failure.sourceId === undefined
                      ? {}
                      : { sourceId: failure.sourceId, includeScreenshot: failure.includeScreenshot }),
                    ...(failure.earlierImageId === undefined
                      ? {}
                      : { earlierImageId: failure.earlierImageId })
                  })
                }
              >
                Retry
              </button>
            ) : failure != null ? (
              <button
                type="button"
                className="secondary-button ask-small-button"
                onClick={() => {
                  setAskDraft(failure.question);
                  input.current?.focus();
                }}
              >
                Edit question
              </button>
            ) : null}
          </div>
        ) : null}
        {shownSource != null || shownEarlierImage !== undefined ? (
          <div className="ask-attachments" aria-label="Attachments for next question">
            {shownSource != null ? (
              <>
                <span className="ask-source-label">
                  {includeScreenshot
                    ? "Screenshot"
                    : shownSource.label === "Screenshot"
                      ? "Screen context"
                      : shownSource.label}
                </span>
                {shownSource.hasImage ? (
                  <button
                    type="button"
                    className="secondary-button ask-small-button"
                    disabled={busy}
                    aria-pressed={includeScreenshot}
                    onClick={() =>
                      setScreenshotChoice({ sourceId: shownSource.id, include: !includeScreenshot })
                    }
                  >
                    Include screenshot
                  </button>
                ) : null}
                <button
                  type="button"
                  className="secondary-button ask-small-button"
                  disabled={busy}
                  onClick={() => setExcludedSource(shownSource.id)}
                >
                  Remove source
                </button>
              </>
            ) : null}
            {shownEarlierImage !== undefined ? (
              <button
                type="button"
                className="secondary-button ask-small-button"
                disabled={busy}
                onClick={() => setEarlierImageId(undefined)}
              >
                Remove earlier screenshot
              </button>
            ) : null}
          </div>
        ) : null}
      </form>

      {busy || Boolean(askSession?.turns.length) ? (
        <div
          className="answer-area ask-transcript"
          ref={transcript}
          role="region"
          aria-label="Conversation"
          tabIndex={0}
          onScroll={(event) => {
            const el = event.currentTarget;
            followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
          }}
        >
          {askSession?.turns.map((turn) => (
            <article className="ask-turn" key={turn.id}>
              <p className="ask-question">{turn.question}</p>
              {turn.sourceLabel ? (
                <div className="ask-turn-source">
                  <span>{turn.sourceLabel}</span>
                  {turn.imageId === undefined ? null : (
                    <button
                      type="button"
                      className="secondary-button ask-small-button"
                      disabled={busy}
                      aria-pressed={shownEarlierImage === turn.imageId}
                      onClick={() =>
                        setEarlierImageId(shownEarlierImage === turn.imageId ? undefined : turn.imageId)
                      }
                    >
                      Attach again
                    </button>
                  )}
                  {turn.sourceLabel === "Screenshot" && turn.imageId === undefined ? (
                    <span>Point at it again to reattach</span>
                  ) : null}
                </div>
              ) : null}
              <FormattedAnswer answer={turn.answer} />
            </article>
          ))}
          {askSession?.pending != null ? (
            <article className="ask-turn" aria-busy="true">
              <p className="ask-question">{askSession.pending.question}</p>
              {askSession.pending.partial ? (
                <FormattedAnswer answer={askSession.pending.partial} />
              ) : (
                <p className="ask-empty">Thinking…</p>
              )}
            </article>
          ) : null}
        </div>
      ) : null}
      <p className="sr-only" role="status">
        {busy ? "Mauz is answering." : askSession?.turns.length ? "Answer ready." : ""}
      </p>
    </section>
  );
}
