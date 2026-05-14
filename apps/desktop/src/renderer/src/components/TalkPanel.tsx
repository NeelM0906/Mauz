import {
  ArrowLeft,
  Camera,
  LoaderCircle,
  Mic,
  MicOff,
  MonitorUp,
  Pause,
  Play,
  Square,
  X
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MauzDesktopContext, RealtimeMode } from "@mauzai/shared";
import {
  canSendScreenFrame,
  getContextLabel,
  getPrimaryImage,
  getVoiceStateForRealtimeEvent,
  hashImage,
  parseRealtimeEvent,
  sendInitialContext,
  sendScreenFrame,
  setMicrophoneMuted,
  stopRealtimeMedia,
  type VoiceState
} from "@renderer/lib/realtimeConversation";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";

const SCREEN_FRAME_INTERVAL_MS = 2_000;

export function TalkPanel({ mode }: { mode: RealtimeMode }): React.JSX.Element {
  const currentContext = useMauzStore((state) => state.currentContext);
  const backToMenu = useMauzStore((state) => state.backToMenu);
  const [voiceState, setVoiceState] = useState<VoiceState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [screenPaused, setScreenPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const lastFrameHashRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const micMutedRef = useRef(false);
  const title = mode === "screen" ? "Share screen" : "Talk to Mauz";
  const hasScreenshot = getPrimaryImage(currentContext) !== undefined;
  const contextLabel = useMemo(() => getContextLabel(currentContext), [currentContext]);

  useEffect(() => {
    pausedRef.current = screenPaused;
  }, [screenPaused]);

  useEffect(() => {
    micMutedRef.current = micMuted;
  }, [micMuted]);

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

      try {
        const { peer, dataChannel, mediaStream } = await startRealtimeConnection({
          mode,
          context: currentContext,
          onVoiceState: setVoiceState,
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

        if (mode === "screen") {
          frameTimerRef.current = window.setInterval(() => {
            void captureAndSendScreenFrame();
          }, SCREEN_FRAME_INTERVAL_MS);
        }
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
  }, [currentContext, mode]);

  const stopCurrentSession = (): void => {
    if (frameTimerRef.current !== null) {
      window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }

    stopRealtime(peerRef.current, dataChannelRef.current, mediaStreamRef.current);
    peerRef.current = null;
    dataChannelRef.current = null;
    mediaStreamRef.current = null;
  };

  const captureAndSendScreenFrame = async (): Promise<void> => {
    if (
      !canSendScreenFrame({
        screenPaused: pausedRef.current,
        dataChannelReady: dataChannelRef.current?.readyState === "open"
      })
    ) {
      return;
    }

    try {
      const nextContext = await mauzClient.captureRealtimeFrame();
      const image =
        nextContext.pointer?.screenshot ?? nextContext.screenshot ?? nextContext.pointer?.cursorCrop;

      if (image === undefined) {
        return;
      }

      const nextHash = hashImage(image);

      if (nextHash === lastFrameHashRef.current) {
        return;
      }

      const dataChannel = dataChannelRef.current;

      if (dataChannel === null) {
        return;
      }

      lastFrameHashRef.current = nextHash;
      sendScreenFrame(dataChannel, nextContext);
      setLastFrameAt(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
      );
    } catch (caught) {
      setScreenPaused(true);
      setVoiceState("error");
      setError(caught instanceof Error ? caught.message : "Screen sharing frame capture failed.");
    }
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
    <section className="realtime-panel" aria-label={title}>
      <header className="realtime-header">
        <button
          className="icon-button"
          type="button"
          aria-label="Back to Mauz menu"
          onClick={() => void handleBack()}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <div>
          <h1>{title}</h1>
          <p>{mode === "screen" ? "Mauz can see screenshots you share." : "Voice is connected to Mauz."}</p>
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
        {getStatusIcon(mode, voiceState)}
        <div>
          <strong>{getStatusTitle(mode, voiceState, screenPaused)}</strong>
          <span>{error ?? getStatusDetail(mode, voiceState, contextLabel, lastFrameAt)}</span>
        </div>
      </div>

      <div className="context-strip" aria-label="Realtime context status">
        <span>
          <Camera aria-hidden="true" size={14} />
          {hasScreenshot ? "Screen context attached" : "No screen context"}
        </span>
        <span>
          <MonitorUp aria-hidden="true" size={14} />
          {mode === "screen" ? (screenPaused ? "Screen paused" : "Screen sharing on") : "Initial view only"}
        </span>
      </div>

      <div className="realtime-actions">
        <button type="button" className="secondary-button" onClick={handleToggleMute}>
          {micMuted ? <MicOff aria-hidden="true" size={15} /> : <Mic aria-hidden="true" size={15} />}
          <span>{micMuted ? "Unmute mic" : "Mute mic"}</span>
        </button>
        {mode === "screen" ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setScreenPaused((paused) => !paused)}
          >
            {screenPaused ? <Play aria-hidden="true" size={15} /> : <Pause aria-hidden="true" size={15} />}
            <span>{screenPaused ? "Resume" : "Pause"}</span>
          </button>
        ) : null}
        <button type="button" className="danger-button" onClick={() => void handleStop()}>
          <Square aria-hidden="true" size={15} />
          <span>Stop</span>
        </button>
      </div>

      <p className="realtime-note">
        {mode === "screen"
          ? "Voice turns are automatic. Screen frames update context only."
          : "Voice turns are automatic. Mute is only for privacy."}
      </p>
    </section>
  );

  function startRealtimeConnection({
    mode,
    context,
    onVoiceState,
    isMuted,
    onError
  }: {
    mode: RealtimeMode;
    context: MauzDesktopContext;
    onVoiceState: (status: VoiceState) => void;
    isMuted: () => boolean;
    onError: (message: string | null) => void;
  }): Promise<{
    peer: RTCPeerConnection;
    dataChannel: RTCDataChannel;
    mediaStream: MediaStream;
  }> {
    return connectRealtime({
      mode,
      context,
      audioElement: audioRef.current,
      onVoiceState,
      isMuted,
      onError
    });
  }
}

type ConnectRealtimeOptions = {
  mode: RealtimeMode;
  context: MauzDesktopContext;
  audioElement: HTMLAudioElement | null;
  onVoiceState(status: VoiceState): void;
  isMuted(): boolean;
  onError(message: string | null): void;
};

async function connectRealtime({
  mode,
  context,
  audioElement,
  onVoiceState,
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
    sendInitialContext(dataChannel, mode, context);
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
    mode,
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

function getStatusIcon(mode: RealtimeMode, state: VoiceState): React.JSX.Element {
  if (state === "connecting") {
    return <LoaderCircle aria-hidden="true" className="spin" size={18} />;
  }

  if (state === "error" || state === "stopped" || state === "muted") {
    return <MicOff aria-hidden="true" size={18} />;
  }

  if (mode === "screen" && state === "listening") {
    return <MonitorUp aria-hidden="true" size={18} />;
  }

  return <Mic aria-hidden="true" size={18} />;
}

function getStatusTitle(mode: RealtimeMode, state: VoiceState, paused: boolean): string {
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

  if (mode === "screen") {
    return paused ? "Listening, screen paused" : "Listening, screen sharing";
  }

  return "Listening";
}

function getStatusDetail(
  mode: RealtimeMode,
  state: VoiceState,
  contextLabel: string,
  lastFrameAt: string | null
): string {
  if (state === "connecting") {
    return "Preparing microphone and Realtime session.";
  }

  if (state === "user_speaking") {
    return "Realtime VAD detected your voice.";
  }

  if (state === "thinking") {
    return "Realtime VAD detected the end of your turn.";
  }

  if (state === "mauz_speaking") {
    return "Audio response is playing.";
  }

  if (state === "muted") {
    return mode === "screen"
      ? "Screen frames can continue while mic audio is muted."
      : "Mauz stays connected.";
  }

  if (state === "stopped") {
    return "Microphone and screen sharing are off.";
  }

  if (mode === "screen") {
    return lastFrameAt === null
      ? `Initial ${contextLabel} context is attached.`
      : `Last screen frame sent at ${lastFrameAt}.`;
  }

  return `Initial ${contextLabel} context is attached.`;
}
