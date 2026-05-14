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
import type { MauzDesktopContext, RealtimeMode, ScreenshotPayload } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";

type RealtimeStatus = "idle" | "connecting" | "listening" | "speaking" | "sharing" | "stopped" | "error";

const SCREEN_FRAME_INTERVAL_MS = 2_000;

export function TalkPanel({ mode }: { mode: RealtimeMode }): React.JSX.Element {
  const currentContext = useMauzStore((state) => state.currentContext);
  const backToMenu = useMauzStore((state) => state.backToMenu);
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [screenPaused, setScreenPaused] = useState(false);
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const frameTimerRef = useRef<number | null>(null);
  const lastFrameHashRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const title = mode === "screen" ? "Share screen" : "Talk to Mauz";
  const hasScreenshot = getPrimaryImage(currentContext) !== undefined;
  const contextLabel = useMemo(() => getContextLabel(currentContext), [currentContext]);

  useEffect(() => {
    pausedRef.current = screenPaused;
  }, [screenPaused]);

  useEffect(() => {
    let disposed = false;

    const start = async (): Promise<void> => {
      if (currentContext === null) {
        setStatus("error");
        setError("Mauz does not have desktop context yet.");
        return;
      }

      setStatus("connecting");
      setError(null);

      try {
        const { peer, dataChannel, mediaStream } = await startRealtimeConnection({
          mode,
          context: currentContext,
          onStatus: setStatus,
          onError: setError
        });

        if (disposed) {
          stopRealtime(peer, dataChannel, mediaStream);
          return;
        }

        peerRef.current = peer;
        dataChannelRef.current = dataChannel;
        mediaStreamRef.current = mediaStream;
        setStatus(mode === "screen" ? "sharing" : "listening");

        if (mode === "screen") {
          frameTimerRef.current = window.setInterval(() => {
            void captureAndSendScreenFrame();
          }, SCREEN_FRAME_INTERVAL_MS);
        }
      } catch (caught) {
        setStatus("error");
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
    if (pausedRef.current || dataChannelRef.current?.readyState !== "open") {
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

      lastFrameHashRef.current = nextHash;
      sendScreenFrame(dataChannelRef.current, nextContext);
      setLastFrameAt(
        new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })
      );
    } catch (caught) {
      setScreenPaused(true);
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "Screen sharing frame capture failed.");
    }
  };

  const handleBack = async (): Promise<void> => {
    stopCurrentSession();
    setStatus("stopped");
    await mauzClient.showMenu();
    backToMenu();
  };

  const handleStop = async (): Promise<void> => {
    stopCurrentSession();
    setStatus("stopped");
    await mauzClient.close();
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

      <div className="realtime-status" data-state={status}>
        {getStatusIcon(mode, status)}
        <div>
          <strong>{getStatusTitle(mode, status, screenPaused)}</strong>
          <span>{error ?? getStatusDetail(mode, status, contextLabel, lastFrameAt)}</span>
        </div>
      </div>

      <div className="context-strip" aria-label="Realtime context status">
        <span>
          <Camera aria-hidden="true" size={14} />
          {hasScreenshot ? "Screen context attached" : "No screen context"}
        </span>
        <span>
          <MonitorUp aria-hidden="true" size={14} />
          {mode === "screen" ? "Screen sharing on" : "Initial view only"}
        </span>
      </div>

      <div className="realtime-actions">
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
          ? "Mauz only receives frames while this panel is open and sharing is not paused."
          : "Mauz uses your microphone after you choose Talk."}
      </p>
    </section>
  );

  function startRealtimeConnection({
    mode,
    context,
    onStatus,
    onError
  }: {
    mode: RealtimeMode;
    context: MauzDesktopContext;
    onStatus: (status: RealtimeStatus) => void;
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
      onStatus,
      onError
    });
  }
}

type ConnectRealtimeOptions = {
  mode: RealtimeMode;
  context: MauzDesktopContext;
  audioElement: HTMLAudioElement | null;
  onStatus(status: RealtimeStatus): void;
  onError(message: string | null): void;
};

async function connectRealtime({
  mode,
  context,
  audioElement,
  onStatus,
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
      onStatus("error");
      onError("Realtime connection was interrupted.");
    }
  };
  dataChannel.onopen = () => {
    sendInitialContext(dataChannel, mode, context);
    onStatus(mode === "screen" ? "sharing" : "listening");
  };
  dataChannel.onmessage = (event) => {
    const parsed = parseRealtimeEvent(event.data);

    if (parsed?.type === "response.audio.delta") {
      onStatus("speaking");
    } else if (parsed?.type === "response.done" || parsed?.type === "input_audio_buffer.speech_started") {
      onStatus(mode === "screen" ? "sharing" : "listening");
    } else if (parsed?.type === "error") {
      onStatus("error");
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

  for (const track of mediaStream?.getTracks() ?? []) {
    track.stop();
  }

  peer?.close();
}

function sendInitialContext(
  dataChannel: RTCDataChannel,
  mode: RealtimeMode,
  context: MauzDesktopContext
): void {
  sendConversationMessage(dataChannel, [
    {
      type: "input_text",
      text: buildRealtimeContextText(mode, context)
    },
    ...getInitialImages(context)
  ]);
}

function sendScreenFrame(dataChannel: RTCDataChannel, context: MauzDesktopContext): void {
  const image = context.pointer?.screenshot ?? context.screenshot ?? context.pointer?.cursorCrop;

  if (image === undefined) {
    return;
  }

  sendConversationMessage(dataChannel, [
    {
      type: "input_text",
      text: "Updated explicit screen-share frame. Use this as current visual context when the user asks about the screen."
    },
    toInputImage(image)
  ]);
}

function sendConversationMessage(dataChannel: RTCDataChannel, content: unknown[]): void {
  dataChannel.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content
      }
    })
  );
}

function buildRealtimeContextText(mode: RealtimeMode, context: MauzDesktopContext): string {
  const selectedText = context.selectedText ?? context.pointer?.selectedText;

  return [
    mode === "screen"
      ? "The user started explicit screen sharing with Mauz."
      : "The user started a voice conversation with Mauz.",
    "Use this desktop context to resolve this, that, and here.",
    "Priority: selected text > cursor crop > active window metadata > full screenshot > cursor position.",
    `Cursor: (${Math.round(context.cursor.x)}, ${Math.round(context.cursor.y)})`,
    `Selected text: ${selectedText?.trim() ? selectedText : "none provided"}`,
    `Active app: ${context.activeApp?.name ?? context.pointer?.activeApp?.name ?? "unknown"}`,
    `Active window: ${context.activeWindow?.title ?? context.pointer?.activeWindow?.title ?? "unknown"}`
  ].join("\n");
}

function getInitialImages(context: MauzDesktopContext): unknown[] {
  const images: unknown[] = [];

  if (context.pointer?.cursorCrop !== undefined) {
    images.push(toInputImage(context.pointer.cursorCrop));
  }

  const screenshot = context.pointer?.screenshot ?? context.screenshot;

  if (screenshot !== undefined) {
    images.push(toInputImage(screenshot));
  }

  return images;
}

function toInputImage(image: ScreenshotPayload): { type: "input_image"; image_url: string; detail: "auto" } {
  return {
    type: "input_image",
    image_url: `data:${image.mimeType};base64,${image.base64}`,
    detail: "auto"
  };
}

function getPrimaryImage(context: MauzDesktopContext | null): ScreenshotPayload | undefined {
  return context?.pointer?.cursorCrop ?? context?.pointer?.screenshot ?? context?.screenshot;
}

function hashImage(image: ScreenshotPayload): string {
  return `${image.mimeType}:${image.width}x${image.height}:${image.base64.length}:${image.base64.slice(0, 96)}:${image.base64.slice(-96)}`;
}

function parseRealtimeEvent(data: unknown): { type?: string } | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as unknown;

    if (typeof parsed === "object" && parsed !== null && "type" in parsed) {
      const event = parsed as { type?: unknown };

      if (typeof event.type === "string") {
        return { type: event.type };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getContextLabel(context: MauzDesktopContext | null): string {
  if (context?.selectedText?.trim()) {
    return "selected text";
  }

  if (context?.pointer?.cursorCrop !== undefined) {
    return "cursor area";
  }

  if (context?.screenshot !== undefined || context?.pointer?.screenshot !== undefined) {
    return "screenshot";
  }

  return "cursor";
}

function getStatusIcon(mode: RealtimeMode, status: RealtimeStatus): React.JSX.Element {
  if (status === "connecting") {
    return <LoaderCircle aria-hidden="true" className="spin" size={18} />;
  }

  if (status === "error" || status === "stopped") {
    return <MicOff aria-hidden="true" size={18} />;
  }

  if (mode === "screen") {
    return <MonitorUp aria-hidden="true" size={18} />;
  }

  return <Mic aria-hidden="true" size={18} />;
}

function getStatusTitle(mode: RealtimeMode, status: RealtimeStatus, paused: boolean): string {
  if (status === "connecting") {
    return "Connecting";
  }

  if (status === "speaking") {
    return "Mauz is speaking";
  }

  if (status === "error") {
    return "Connection issue";
  }

  if (status === "stopped") {
    return "Stopped";
  }

  if (mode === "screen") {
    return paused ? "Screen sharing paused" : "Mauz can see your screen";
  }

  return "Listening";
}

function getStatusDetail(
  mode: RealtimeMode,
  status: RealtimeStatus,
  contextLabel: string,
  lastFrameAt: string | null
): string {
  if (status === "connecting") {
    return "Preparing microphone and Realtime session.";
  }

  if (status === "speaking") {
    return "Audio response is playing.";
  }

  if (status === "stopped") {
    return "Microphone and screen sharing are off.";
  }

  if (mode === "screen") {
    return lastFrameAt === null
      ? `Initial ${contextLabel} context is attached.`
      : `Last screen frame sent at ${lastFrameAt}.`;
  }

  return `Initial ${contextLabel} context is attached.`;
}
