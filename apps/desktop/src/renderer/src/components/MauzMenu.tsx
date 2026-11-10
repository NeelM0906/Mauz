import { BriefcaseBusiness, Mic, ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProvidersStatusResponse } from "@mauzai/shared";
import { mauz } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

type BubbleKey = "ask" | "task" | "dictate";

const PANEL_FOR_BUBBLE = { ask: "lens", task: "task", dictate: "dictate" } as const;

// Bubble offsets from the cluster center.
const BUBBLE_POSITIONS: Record<BubbleKey, { tx: number; ty: number }> = {
  ask: { tx: -95, ty: -55 },
  task: { tx: 95, ty: -55 },
  dictate: { tx: 0, ty: 110 }
};

const BUBBLE_STAGGER_MS = 30;

function bubbleStyle(key: BubbleKey, order: number, size = 52): React.CSSProperties {
  const position = BUBBLE_POSITIONS[key];
  const half = size / 2;

  return {
    left: `calc(50% - ${half}px + ${position.tx}px)`,
    top: `calc(50% - ${half}px + ${position.ty}px)`,
    "--delay": `${order * BUBBLE_STAGGER_MS}ms`
  } as React.CSSProperties;
}

export function MauzMenu(): React.JSX.Element {
  const { settings, status, setCurrentContext, setMode, setSettings, setStatus } = useMauzStore();
  const [pendingAction, setPendingAction] = useState<BubbleKey | null>(null);
  const [providersStatus, setProvidersStatus] = useState<AiProvidersStatusResponse | null>(null);

  useEffect(() => {
    let disposed = false;

    void mauz()
      .providers.status()
      .then(
        (status) => {
          if (!disposed) {
            setProvidersStatus(status);
          }
        },
        () => {
          // The status dot stays neutral; asking still reports a precise error.
        }
      );

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const loadSettings = async (): Promise<void> => {
      try {
        const loadedSettings = await mauz().settings.open({
          resizePopover: false
        });

        if (!disposed) {
          setSettings(loadedSettings);
        }
      } catch (error) {
        if (!disposed) {
          setStatus(error instanceof Error ? error.message : "Mauz settings failed.");
        }
      }
    };

    if (settings === null) {
      void loadSettings();
    }

    return () => {
      disposed = true;
    };
  }, [setSettings, setStatus, settings]);

  const handleSettings = async (): Promise<void> => {
    setStatus(null);

    try {
      const settings = await mauz().settings.open();
      setSettings(settings);
      setMode("settings");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz settings failed.");
    }
  };

  /** Captures what is under the pointer now; the panel's question or task is about it. */
  const openPanel = async (bubble: BubbleKey): Promise<void> => {
    setPendingAction(bubble);
    setStatus(null);

    try {
      const context = await mauz().menu.startAsk();
      setCurrentContext(context);
      await mauz().menu.setLensExpanded({ expanded: true });
      setMode(PANEL_FOR_BUBBLE[bubble]);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const providerState = getProviderState(providersStatus);
  const providerLabel = getActiveProviderLabel(providersStatus);

  return (
    <section className="bubble-cluster-root" aria-label="Mauz menu">
      <h1 className="sr-only">MauzAI</h1>

      <button
        type="button"
        className="bubble-cluster-backdrop"
        aria-label="Close Mauz"
        tabIndex={-1}
        onClick={() => void mauz().menu.close()}
      />

      <div className="bubble-cluster">
        <button
          type="button"
          className="bubble-hub"
          aria-label="Open Mauz"
          disabled={pendingAction !== null}
          onClick={() => void handleSettings()}
        >
          <BrandLogo className="bubble-hub-logo" label="MauzAI" />
          {providerState !== "unknown" ? (
            <span
              className="bubble-auth-dot"
              data-status={providerState}
              role="img"
              aria-label={providerLabel ?? "No AI provider set up"}
              title={providerLabel ?? "No AI provider set up"}
            />
          ) : null}
        </button>

        <button
          type="button"
          className="bubble"
          data-accent="answer"
          data-pending={pendingAction === "ask" ? "true" : undefined}
          aria-label="Ask about what's on screen"
          disabled={pendingAction !== null}
          onClick={() => void openPanel("ask")}
          style={bubbleStyle("ask", 0)}
        >
          <ScanSearch aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            {pendingAction === "ask" ? "Capturing..." : "Ask"}
          </span>
        </button>

        <button
          type="button"
          className="bubble"
          data-accent="agent"
          data-pending={pendingAction === "task" ? "true" : undefined}
          aria-label="Send to agent"
          disabled={pendingAction !== null}
          onClick={() => void openPanel("task")}
          style={bubbleStyle("task", 1)}
        >
          <BriefcaseBusiness aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            {pendingAction === "task" ? "Capturing..." : "Send to agent"}
          </span>
        </button>

        <button
          type="button"
          className="bubble"
          data-pending={pendingAction === "dictate" ? "true" : undefined}
          aria-label="Dictate"
          disabled={pendingAction !== null}
          onClick={() => void openPanel("dictate")}
          style={bubbleStyle("dictate", 2)}
        >
          <Mic aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            {pendingAction === "dictate" ? "Capturing..." : "Dictate"}
          </span>
        </button>
      </div>

      {status !== null ? (
        <p className="bubble-status-toast" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function getProviderState(status: AiProvidersStatusResponse | null): "connected" | "missing" | "unknown" {
  if (status === null) {
    return "unknown";
  }

  return status.activeProviderId === null ? "missing" : "connected";
}

function getActiveProviderLabel(status: AiProvidersStatusResponse | null): string | null {
  const active = status?.providers.find((provider) => provider.id === status.activeProviderId);

  return active === undefined ? null : `Answering with ${active.label} (${active.model})`;
}
