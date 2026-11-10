import { ArrowLeft, BriefcaseBusiness, LoaderCircle, Mic, ScanSearch, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { recordingToWav } from "@renderer/lib/pushToTalk";
import { mauz } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

type DictateState = "starting" | "listening" | "transcribing" | "ready" | "error";

const MIN_RECORDING_MS = 350;

/**
 * Dictate: speech becomes text, which the user then sends to Ask or to their agent. The
 * screen context was captured when the dial opened, so both use what was under the pointer.
 */
export function DictatePanel(): React.JSX.Element {
  const backToMenu = useMauzStore((state) => state.backToMenu);
  const setDictation = useMauzStore((state) => state.setDictation);
  const setMode = useMauzStore((state) => state.setMode);
  const [state, setState] = useState<DictateState>("starting");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Bumped when a recording is abandoned, so a late transcription for it is dropped.
  const generationRef = useRef(0);

  const releaseMicrophone = useCallback((): void => {
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.stop();
    }

    streamRef.current = null;
  }, []);

  const abandonRecording = useCallback((): void => {
    generationRef.current += 1;
    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder !== null && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }

    releaseMicrophone();
  }, [releaseMicrophone]);

  const startListening = useCallback(async (): Promise<void> => {
    abandonRecording();
    const generation = generationRef.current;
    setError(null);
    setState("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });

      if (generation !== generationRef.current) {
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
      setState("listening");
    } catch {
      releaseMicrophone();
      setState("error");
      setError("Mauz could not use the microphone. Check your microphone privacy settings.");
    }
  }, [abandonRecording, releaseMicrophone]);

  const stopListening = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;

    if (recorder === null || recorder.state === "inactive") {
      return;
    }

    const generation = generationRef.current;
    const recording = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    releaseMicrophone();
    setState("transcribing");

    try {
      const audio = await recordingToWav(recording);

      if (generation !== generationRef.current) {
        return;
      }

      if (audio.durationMs < MIN_RECORDING_MS) {
        setState("ready");
        return;
      }

      const transcription = await mauz().talk.transcribe({
        audioBase64: audio.base64,
        mimeType: "audio/wav"
      });

      if (generation !== generationRef.current) {
        return;
      }

      const heard = transcription.text.trim();

      if (heard.length === 0) {
        setError("Mauz didn't catch that. Record again.");
      } else {
        setText((current) => (current.trim().length === 0 ? heard : `${current.trimEnd()} ${heard}`));
      }

      setState("ready");
    } catch (caught) {
      if (generation === generationRef.current) {
        setState("error");
        setError(caught instanceof Error ? caught.message : "Mauz could not transcribe that.");
      }
    }
  }, [releaseMicrophone]);

  useEffect(() => {
    void startListening();
    return abandonRecording;
  }, [abandonRecording, startListening]);

  useEffect(() => mauz().menu.onHidden(abandonRecording), [abandonRecording]);

  useEffect(() => {
    // Space stops listening, like a dictation key; it types normally in the text box.
    const handleKeyDown = (event: KeyboardEvent): void => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA");

      if (!typing && (event.code === "Space" || event.key === " ") && !event.repeat) {
        event.preventDefault();
        void (recorderRef.current === null ? startListening() : stopListening());
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [startListening, stopListening]);

  const handOff = (target: "ask" | "task"): void => {
    abandonRecording();
    setDictation(text.trim());

    setMode(target === "ask" ? "lens" : "task");
  };

  const handleBack = async (): Promise<void> => {
    abandonRecording();
    await mauz().menu.showMenu();
    backToMenu();
  };

  const listening = state === "listening" || state === "starting";
  const busy = state === "transcribing";
  const canSend = !listening && !busy && text.trim().length > 0;

  return (
    <section className="lens-panel lens-task-panel dictate-panel" aria-label="Dictate">
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
            <h1 tabIndex={-1}>Dictate</h1>
            <p>Speak, then send it to Ask or your agent.</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => {
            abandonRecording();
            void mauz().menu.close();
          }}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <div className="dictate-status" data-state={state} role="status" aria-live="polite">
        {busy ? (
          <LoaderCircle aria-hidden="true" className="spin" size={18} />
        ) : (
          <Mic aria-hidden="true" size={18} />
        )}
        <span>{error ?? getStatusText(state)}</span>
        {listening ? (
          <button type="button" className="danger-button" onClick={() => void stopListening()}>
            <Square aria-hidden="true" size={13} />
            <span>Stop</span>
          </button>
        ) : (
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={() => void startListening()}
          >
            <Mic aria-hidden="true" size={13} />
            <span>{text.trim().length > 0 ? "Add more" : "Record"}</span>
          </button>
        )}
      </div>

      <textarea
        className="dictate-text"
        aria-label="Dictated text"
        value={text}
        placeholder={listening ? "Listening..." : "Your words appear here. You can edit them."}
        onChange={(event) => setText(event.target.value)}
        disabled={busy}
      />

      <div className="dictate-actions">
        <button type="button" className="submit-button" disabled={!canSend} onClick={() => handOff("ask")}>
          <ScanSearch aria-hidden="true" size={15} />
          <span>Ask</span>
        </button>
        <button type="button" className="submit-button" disabled={!canSend} onClick={() => handOff("task")}>
          <BriefcaseBusiness aria-hidden="true" size={15} />
          <span>Send to agent</span>
        </button>
      </div>
    </section>
  );
}

function getStatusText(state: DictateState): string {
  switch (state) {
    case "starting":
      return "Opening the microphone...";
    case "listening":
      return "Listening. Press Stop or Space when you're done.";
    case "transcribing":
      return "Turning your words into text...";
    default:
      return "Edit the text if needed, then pick where it goes.";
  }
}
