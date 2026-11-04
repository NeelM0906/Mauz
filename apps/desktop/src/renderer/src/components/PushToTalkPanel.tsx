import { ArrowLeft, Camera, LoaderCircle, Mic, MicOff, Square, Volume2, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage, MauzDesktopContext } from "@mauzai/shared";
import { getContextLabel, getPrimaryImage } from "@renderer/lib/realtimeConversation";
import { recordingToWav, SpeechQueue } from "@renderer/lib/pushToTalk";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

type TurnState = "ready" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

type TranscriptCue = {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
};

const TRANSCRIPT_CUE_LIMIT = 6;
const MIN_RECORDING_MS = 350;
const MAX_HISTORY_MESSAGES = 12;

/**
 * Push-to-talk voice: hold to talk, the clip is transcribed, answered by the user's AI
 * provider with a fresh look at the screen, and the reply is spoken sentence by sentence.
 */
export function PushToTalkPanel(): React.JSX.Element {
  const initialContext = useMauzStore((state) => state.currentContext);
  const backToMenu = useMauzStore((state) => state.backToMenu);
  const [turnState, setTurnState] = useState<TurnState>("ready");
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const listeningRef = useRef(false);
  const pendingContextRef = useRef<MauzDesktopContext | null>(initialContext);
  const historyRef = useRef<ChatMessage[]>([]);
  const speechRef = useRef<SpeechQueue | null>(null);
  const requestIdRef = useRef<string | null>(null);
  // Bumped whenever a turn is abandoned, so slow transcriptions and answers for it are dropped.
  const turnGenerationRef = useRef(0);
  const hasScreenContext = getPrimaryImage(initialContext) !== undefined;

  const upsertCue = useCallback((cue: TranscriptCue): void => {
    setCues((current) => {
      const index = current.findIndex((item) => item.id === cue.id);
      const next = index >= 0 ? current.map((item, i) => (i === index ? cue : item)) : [...current, cue];

      return next.slice(-TRANSCRIPT_CUE_LIMIT);
    });
  }, []);

  useEffect(() => {
    return mauzClient.onAnswerDelta(({ requestId, text }) => {
      if (requestId !== requestIdRef.current) {
        return;
      }

      speechRef.current?.update(text);
      upsertCue({ id: `assistant:${requestId}`, role: "assistant", text, final: false });
    });
  }, [upsertCue]);

  const runTurn = useCallback(
    async (recording: Blob): Promise<void> => {
      const generation = turnGenerationRef.current;
      const isAbandoned = (): boolean => generation !== turnGenerationRef.current;
      setTurnState("transcribing");

      try {
        const audio = await recordingToWav(recording);

        if (isAbandoned()) {
          return;
        }

        if (audio.durationMs < MIN_RECORDING_MS) {
          setTurnState("ready");
          return;
        }

        const transcription = await mauzClient.transcribeTalk({
          audioBase64: audio.base64,
          mimeType: "audio/wav"
        });
        const question = transcription.text.trim();

        if (isAbandoned()) {
          return;
        }

        if (question.length === 0) {
          setTurnState("ready");
          setError("Mauz didn't catch that. Hold Space and try again.");
          return;
        }

        const requestId = crypto.randomUUID();
        requestIdRef.current = requestId;
        upsertCue({ id: `user:${requestId}`, role: "user", text: question, final: true });
        setTurnState("thinking");

        // The first turn uses the context captured when Talk opened; later turns look again.
        const context = pendingContextRef.current ?? (await mauzClient.captureTalkContext());
        pendingContextRef.current = null;

        if (isAbandoned()) {
          return;
        }
        const speech = new SpeechQueue({
          onStart: () => {
            if (requestIdRef.current === requestId) {
              setTurnState("speaking");
            }
          },
          onIdle: () => {
            if (requestIdRef.current === requestId) {
              setTurnState("ready");
            }
          }
        });
        speechRef.current = speech;

        const response = await mauzClient.submitAsk({
          question,
          context,
          responseStyle: "voice",
          conversationMessages: historyRef.current.slice(-MAX_HISTORY_MESSAGES),
          requestId
        });

        if (requestIdRef.current !== requestId) {
          return;
        }

        speech.finish(response.answer);
        upsertCue({ id: `assistant:${requestId}`, role: "assistant", text: response.answer, final: true });
        const now = new Date().toISOString();
        historyRef.current.push(
          { id: `user:${requestId}`, role: "user", content: question, createdAt: now },
          { id: `assistant:${requestId}`, role: "assistant", content: response.answer, createdAt: now }
        );

        if (!speech.isSpeaking) {
          setTurnState("ready");
        }
      } catch (caught) {
        if (isAbandoned()) {
          return;
        }

        setTurnState("error");
        setError(caught instanceof Error ? caught.message : "Mauz could not finish that turn.");
      }
    },
    [upsertCue]
  );

  /** The microphone is only open while Space is held, so the OS mic indicator matches. */
  const releaseMicrophone = useCallback((): void => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = null;
  }, []);

  /** Stops speaking, drops any in-flight answer, and discards a recording in progress. */
  const stopTalk = useCallback((): void => {
    turnGenerationRef.current += 1;
    speechRef.current?.cancel();
    requestIdRef.current = null;
    listeningRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder !== null && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }

    releaseMicrophone();
    setTurnState("ready");
  }, [releaseMicrophone]);

  useEffect(() => mauzClient.onPopoverHidden(stopTalk), [stopTalk]);

  const startListening = useCallback(async (): Promise<void> => {
    if (listeningRef.current) {
      return;
    }

    // Talking over Mauz interrupts it, including a turn that is still being transcribed.
    turnGenerationRef.current += 1;
    const generation = turnGenerationRef.current;
    speechRef.current?.cancel();
    requestIdRef.current = null;
    listeningRef.current = true;
    setError(null);
    setTurnState("listening");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });

      // Space was released, pressed again, or Talk was hidden while the microphone was opening.
      if (!listeningRef.current || generation !== turnGenerationRef.current) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
        return;
      }

      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorderRef.current = recorder;
      recorder.start();
    } catch {
      listeningRef.current = false;
      releaseMicrophone();
      setTurnState("error");
      setError("Mauz could not use the microphone. Check your microphone privacy settings.");
    }
  }, [releaseMicrophone]);

  const stopListening = useCallback(async (): Promise<void> => {
    if (!listeningRef.current) {
      return;
    }

    listeningRef.current = false;
    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder === null || recorder.state === "inactive") {
      releaseMicrophone();
      setTurnState("ready");
      return;
    }

    const recording = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });

    releaseMicrophone();
    await runTurn(recording);
  }, [releaseMicrophone, runTurn]);

  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
    // `code` comes from the hardware scan code; some remapped or synthetic keyboards only set `key`.
    const isSpace = (event: KeyboardEvent): boolean => event.code === "Space" || event.key === " ";
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (isSpace(event) && !event.repeat && !isTyping(event.target)) {
        event.preventDefault();
        void startListening();
      }
    };
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (isSpace(event) && !isTyping(event.target)) {
        event.preventDefault();
        void stopListening();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [startListening, stopListening]);

  useEffect(() => stopTalk, [stopTalk]);

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleClose = (): void => {
    stopTalk();
    void mauzClient.close();
  };

  return (
    <section className="realtime-panel" aria-label="Talk to Mauz">
      <header className="realtime-header">
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
            <h1 tabIndex={-1}>Talk to Mauz</h1>
            <p>Hold Space to talk. Point at things while you speak.</p>
          </div>
        </div>
        <button className="icon-button" type="button" aria-label="Close Mauz" onClick={handleClose}>
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="realtime-status" data-state={toStatusStyle(turnState)}>
        {getStatusIcon(turnState)}
        <div>
          <strong>{getStatusTitle(turnState)}</strong>
          <span>{error ?? getStatusDetail(turnState, getContextLabel(initialContext))}</span>
        </div>
      </div>

      <div className="context-strip" aria-label="Talk context status">
        <span>
          <Camera aria-hidden="true" size={14} />
          {hasScreenContext ? "Fresh screen context each turn" : "No screen context"}
        </span>
        <span>
          <Mic aria-hidden="true" size={14} />
          Push to talk
        </span>
      </div>

      <div className="transcript-stream" aria-live="polite" aria-label="Voice transcript">
        {cues.length === 0 ? (
          <div className="transcript-placeholder" data-state="listening" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : (
          cues.map((cue) => (
            <div
              key={cue.id}
              className="transcript-cue"
              data-role={cue.role}
              data-state={cue.final ? "final" : "partial"}
            >
              <span>{cue.role === "user" ? "You" : "Mauz"}</span>
              <p>{cue.text}</p>
            </div>
          ))
        )}
      </div>

      <div className="realtime-actions">
        <button
          type="button"
          className="secondary-button"
          aria-pressed={turnState === "listening"}
          onPointerDown={() => void startListening()}
          onPointerUp={() => void stopListening()}
          onPointerLeave={() => void stopListening()}
        >
          <Mic aria-hidden="true" size={15} />
          <span>{turnState === "listening" ? "Listening..." : "Hold to talk"}</span>
        </button>
        <button type="button" className="danger-button" onClick={handleClose}>
          <Square aria-hidden="true" size={15} />
          <span>Stop</span>
        </button>
      </div>
    </section>
  );
}

function toStatusStyle(state: TurnState): string {
  switch (state) {
    case "listening":
      return "user_speaking";
    case "transcribing":
    case "thinking":
      return "thinking";
    case "speaking":
      return "mauz_speaking";
    case "error":
      return "error";
    default:
      return "listening";
  }
}

function getStatusIcon(state: TurnState): React.JSX.Element {
  if (state === "transcribing" || state === "thinking") {
    return <LoaderCircle aria-hidden="true" className="spin" size={18} />;
  }

  if (state === "speaking") {
    return <Volume2 aria-hidden="true" size={18} />;
  }

  if (state === "error") {
    return <MicOff aria-hidden="true" size={18} />;
  }

  return <Mic aria-hidden="true" size={18} />;
}

function getStatusTitle(state: TurnState): string {
  switch (state) {
    case "listening":
      return "Listening";
    case "transcribing":
      return "Transcribing";
    case "thinking":
      return "Mauz is thinking";
    case "speaking":
      return "Mauz is speaking";
    case "error":
      return "Something went wrong";
    default:
      return "Ready";
  }
}

function getStatusDetail(state: TurnState, contextLabel: string): string {
  switch (state) {
    case "listening":
      return "Release Space when you're done.";
    case "transcribing":
      return "Turning your voice into text.";
    case "thinking":
      return "Looking at your screen and answering.";
    case "speaking":
      return "Press Space to interrupt.";
    default:
      return `Hold Space to ask about the ${contextLabel}.`;
  }
}
