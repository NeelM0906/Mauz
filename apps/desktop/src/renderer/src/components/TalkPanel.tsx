import { ArrowLeft, Camera, LoaderCircle, Mic, MicOff, Square, X } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MauzDesktopContext } from "@mauzai/shared";
import {
  getContextLabel,
  getPrimaryImage,
  getTranscriptCueForRealtimeEvent,
  getVoiceStateForRealtimeEvent,
  parseRealtimeEvent,
  sendInitialContext,
  setMicrophoneMuted,
  stopRealtimeMedia,
  type RealtimeTranscriptCue,
  type VoiceState
} from "@renderer/lib/realtimeConversation";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

const TRANSCRIPT_CUE_LIMIT = 5;

type TranscriptCue = {
  id: string;
  role: RealtimeTranscriptCue["role"];
  text: string;
  final: boolean;
  updatedAt: number;
};

export function TalkPanel(): React.JSX.Element {
  const currentContext = useMauzStore((state) => state.currentContext);
  const backToMenu = useMauzStore((state) => state.backToMenu);
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [transcriptCues, setTranscriptCues] = useState<TranscriptCue[]>([]);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const micMutedRef = useRef(false);
  const hasScreenshot = getPrimaryImage(currentContext) !== undefined;
  const contextLabel = useMemo(() => getContextLabel(currentContext), [currentContext]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

  const handleTranscriptCue = useCallback((cue: RealtimeTranscriptCue): void => {
    setTranscriptCues((current) => {
      const existingIndex = current.findIndex((item) => item.id === cue.id && item.role === cue.role);
      const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
      const nextText = cue.kind === "delta" ? `${existing?.text ?? ""}${cue.text}` : cue.text;
      const normalizedText = normalizeTranscriptText(nextText);

      if (normalizedText.length === 0) {
        return current;
      }

      const nextCue: TranscriptCue = {
        id: cue.id,
        role: cue.role,
        text: normalizedText,
        final: cue.kind === "final",
        updatedAt: Date.now()
      };
      const next =
        existingIndex >= 0
          ? current.map((item, index) => (index === existingIndex ? nextCue : item))
          : [...current, nextCue];

      return [...next].sort((left, right) => left.updatedAt - right.updatedAt).slice(-TRANSCRIPT_CUE_LIMIT);
    });
  }, []);

  useEffect(() => {
    let disposed = false;

    const start = async (): Promise<void> => {
      if (currentContext === null) {
        setVoiceState("error");
        setError("Mauz does not have desktop context yet.");
        return;
      }

      setVoiceState("connecting");
      setError(null);
      setTranscriptCues([]);

      try {
        const { peer, dataChannel, mediaStream } = await connectRealtime({
          context: currentContext,
          audioElement: audioRef.current,
          onVoiceState: setVoiceState,
          onTranscriptCue: handleTranscriptCue,
          isMuted: () => micMutedRef.current,
          onError: setError
        });

        if (disposed) {
          stopRealtime(peer, dataChannel, mediaStream);
          return;
        }

        peerRef.current = peer;
        dataChannelRef.current = dataChannel;
        mediaStreamRef.current = mediaStream;
        setVoiceState(micMutedRef.current ? "muted" : "listening");
      } catch (caught) {
        setVoiceState("error");
        setError(caught instanceof Error ? caught.message : "Realtime connection failed.");
      }
    };

    void start();

    return () => {
      disposed = true;
      stopCurrentSession();
    };
  }, [currentContext, handleTranscriptCue]);

  const stopCurrentSession = (): void => {
    stopRealtime(peerRef.current, dataChannelRef.current, mediaStreamRef.current);
    peerRef.current = null;
    dataChannelRef.current = null;
    mediaStreamRef.current = null;
  };

  const handleBack = async (): Promise<void> => {
    stopCurrentSession();
    setVoiceState("stopped");
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleStop = async (): Promise<void> => {
    stopCurrentSession();
    setVoiceState("stopped");
    await mauzClient.close();
  };

  const handleToggleMute = (): void => {
    const nextMuted = !micMutedRef.current;
    micMutedRef.current = nextMuted;
    setMicMuted(nextMuted);
    setMicrophoneMuted(mediaStreamRef.current, nextMuted);
    setVoiceState(nextMuted ? "muted" : "listening");
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
            <h1>Talk to Mauz</h1>
            <p>Voice is connected to Mauz.</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => void handleStop()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <audio ref={audioRef} autoPlay />

      <div className="realtime-status" data-state={voiceState}>
        {getStatusIcon(voiceState)}
        <div>
          <strong>{getStatusTitle(voiceState)}</strong>
          <span>{error ?? getStatusDetail(voiceState, contextLabel)}</span>
        </div>
      </div>

      <div className="context-strip" aria-label="Realtime context status">
        <span>
          <Camera aria-hidden="true" size={14} />
          {hasScreenshot ? "Screen context attached" : "No screen context"}
        </span>
        <span>
          <Mic aria-hidden="true" size={14} />
          Voice only
        </span>
      </div>

      <div className="transcript-stream" aria-live="polite" aria-label="Live voice transcript">
        {transcriptCues.length === 0 ? (
          <div className="transcript-placeholder" data-state={voiceState} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : (
          transcriptCues.map((cue) => (
            <div
              key={`${cue.role}:${cue.id}`}
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
        <button type="button" className="secondary-button" onClick={handleToggleMute}>
          {micMuted ? <MicOff aria-hidden="true" size={15} /> : <Mic aria-hidden="true" size={15} />}
          <span>{micMuted ? "Unmute mic" : "Mute mic"}</span>
        </button>
        <button type="button" className="danger-button" onClick={() => void handleStop()}>
          <Square aria-hidden="true" size={15} />
          <span>Stop</span>
        </button>
      </div>
    </section>
  );
}

type ConnectRealtimeOptions = {
  context: MauzDesktopContext;
  audioElement: HTMLAudioElement | null;
  onVoiceState(status: VoiceState): void;
  onTranscriptCue(cue: RealtimeTranscriptCue): void;
  isMuted(): boolean;
  onError(message: string | null): void;
};

async function connectRealtime({
  context,
  audioElement,
  onVoiceState,
  onTranscriptCue,
  isMuted,
  onError
}: ConnectRealtimeOptions): Promise<{
  peer: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  mediaStream: MediaStream;
}> {
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    throw new Error("Microphone access is not available in this renderer.");
  }

  const peer = new RTCPeerConnection();
  const dataChannel = peer.createDataChannel("oai-events");
  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  peer.ontrack = (event) => {
    if (audioElement !== null) {
      audioElement.srcObject = event.streams[0] ?? null;
    }
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
      onVoiceState("error");
      onError("Realtime connection was interrupted.");
    }
  };
  dataChannel.onopen = () => {
    sendInitialContext(dataChannel, context);
    onVoiceState(isMuted() ? "muted" : "listening");
  };
  dataChannel.onmessage = (event) => {
    const parsed = parseRealtimeEvent(event.data);

    if (parsed === null) {
      return;
    }

    const nextState = getVoiceStateForRealtimeEvent(parsed, {
      muted: isMuted()
    });

    if (nextState !== null) {
      onVoiceState(nextState);
    }

    const transcriptCue = getTranscriptCueForRealtimeEvent(parsed);

    if (transcriptCue !== null) {
      onTranscriptCue(transcriptCue);
    }

    if (parsed.type === "error") {
      onError("Realtime model returned an error.");
    }
  };

  for (const track of mediaStream.getAudioTracks()) {
    peer.addTrack(track, mediaStream);
  }

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);

  if (offer.sdp === undefined) {
    throw new Error("Could not create a Realtime offer.");
  }

  const response = await mauzClient.connectRealtime({
    offerSdp: offer.sdp,
    mode: "talk",
    context
  });

  await peer.setRemoteDescription({
    type: "answer",
    sdp: response.answerSdp
  });

  return { peer, dataChannel, mediaStream };
}

function stopRealtime(
  peer: RTCPeerConnection | null,
  dataChannel: RTCDataChannel | null,
  mediaStream: MediaStream | null
): void {
  if (dataChannel !== null && dataChannel.readyState !== "closed") {
    dataChannel.close();
  }

  stopRealtimeMedia(mediaStream);

  peer?.close();
}

function getStatusIcon(state: VoiceState): React.JSX.Element {
  if (state === "connecting") {
    return <LoaderCircle aria-hidden="true" className="spin" size={18} />;
  }

  if (state === "error" || state === "stopped" || state === "muted") {
    return <MicOff aria-hidden="true" size={18} />;
  }

  return <Mic aria-hidden="true" size={18} />;
}

function getStatusTitle(state: VoiceState): string {
  if (state === "connecting") {
    return "Connecting";
  }

  if (state === "user_speaking") {
    return "You're speaking";
  }

  if (state === "thinking") {
    return "Mauz is thinking";
  }

  if (state === "mauz_speaking") {
    return "Mauz is speaking";
  }

  if (state === "muted") {
    return "Mic muted";
  }

  if (state === "error") {
    return "Connection issue";
  }

  if (state === "stopped") {
    return "Stopped";
  }

  return "Listening";
}

function getStatusDetail(state: VoiceState, contextLabel: string): string {
  if (state === "connecting") {
    return "Preparing microphone and Realtime session.";
  }

  if (state === "user_speaking") {
    return "Microphone is receiving your voice.";
  }

  if (state === "thinking") {
    return "Your turn ended. Mauz is preparing a response.";
  }

  if (state === "mauz_speaking") {
    return "Audio response is playing.";
  }

  if (state === "muted") {
    return "Mauz stays connected.";
  }

  if (state === "stopped") {
    return "Microphone is off.";
  }

  return `Initial ${contextLabel} context is attached.`;
}

function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
