import {
  BriefcaseBusiness,
  GitCompareArrows,
  History,
  KeyRound,
  Mic,
  Pin,
  ScanSearch,
  Settings,
  Sparkles,
  Wand2
} from "lucide-react";
import { useEffect, useState } from "react";
import type { MauzSettings } from "@mauzai/shared";
import type { LensAction } from "@renderer/state/useMauzStore";
import { detectLensObject, toLensMemory } from "@renderer/lib/lensObject";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

type MenuAction = LensAction | "task" | "talk";
type AuthAction = "connect" | "disconnect";

const LENS_ACTIONS: Array<{
  action: LensAction;
  label: string;
  detail: string;
  icon: typeof ScanSearch;
}> = [
  {
    action: "ask",
    label: "Ask",
    detail: "Ask a question about this",
    icon: ScanSearch
  },
  {
    action: "explain",
    label: "Explain",
    detail: "Explain key points simply",
    icon: Sparkles
  },
  {
    action: "transform",
    label: "Transform",
    detail: "Rewrite, summarize, or adapt",
    icon: Wand2
  },
  {
    action: "remember",
    label: "Remember",
    detail: "Pin this as memory",
    icon: Pin
  },
  {
    action: "compare",
    label: "Compare",
    detail: "Compare this with another object",
    icon: GitCompareArrows
  }
];

type BubbleKey = LensAction | "task" | "talk" | "history" | "settings";

// Bubble offsets from the cluster center (arc radius ~110px).
const BUBBLE_POSITIONS: Record<BubbleKey, { tx: number; ty: number }> = {
  ask: { tx: -95, ty: -55 },
  explain: { tx: 0, ty: -110 },
  transform: { tx: 95, ty: -55 },
  remember: { tx: 95, ty: 55 },
  compare: { tx: 80, ty: 107 },
  task: { tx: 0, ty: 118 },
  talk: { tx: -80, ty: 107 },
  history: { tx: -95, ty: 55 },
  settings: { tx: -110, ty: 0 }
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
  const {
    settings,
    status,
    setAskAnswer,
    setAskConversationTitle,
    setAskError,
    setAskLoading,
    setChatHistory,
    setCurrentContext,
    setMode,
    setPinnedLensObject,
    setSelectedConversation,
    setSelectedLensAction,
    setSettings,
    setStatus
  } = useMauzStore();
  const [pendingAction, setPendingAction] = useState<MenuAction | null>(null);
  const [pendingAuthAction, setPendingAuthAction] = useState<AuthAction | null>(null);

  useEffect(() => {
    let disposed = false;

    const loadSettings = async (): Promise<void> => {
      try {
        const loadedSettings = await mauzClient.openSettings({
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
      const settings = await mauzClient.openSettings();
      setSettings(settings);
      setMode("settings");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz settings failed.");
    }
  };

  const handleHistory = async (): Promise<void> => {
    setStatus(null);

    try {
      const history = await mauzClient.listChatHistory();
      setChatHistory(history);
      setSelectedConversation(null);
      setMode("history");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz chat history failed.");
    }
  };

  const handleOpenAiReconnect = async (): Promise<void> => {
    setPendingAuthAction("connect");
    setStatus(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        openAiAuthDisconnected: false
      });

      setSettings(nextSettings);

      if (nextSettings.apiKeyConfigured && settings?.apiKeyConfigured !== true) {
        setStatus(getOpenAiReconnectMessage(nextSettings));
        return;
      }

      const openedSettings = await mauzClient.openSettings();
      setSettings(openedSettings);
      setMode("settings");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OpenAI reconnect failed.");
    } finally {
      setPendingAuthAction(null);
    }
  };

  const handleLensAction = async (action: LensAction): Promise<void> => {
    setPendingAction(action);
    setStatus(null);
    setAskAnswer(null);
    setAskConversationTitle(null);
    setAskError(null);
    setAskLoading(false);

    try {
      const context = await mauzClient.startAsk();
      const lensObject = detectLensObject(context);

      setCurrentContext(context);
      setSelectedLensAction(action);

      if (action === "remember") {
        setPinnedLensObject(toLensMemory(lensObject));
      }

      await mauzClient.setLensExpanded({
        expanded: true
      });
      setMode("lens");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleTask = async (): Promise<void> => {
    setPendingAction("task");
    setStatus(null);
    setAskAnswer(null);
    setAskConversationTitle(null);
    setAskError(null);
    setAskLoading(false);

    try {
      const context = await mauzClient.startAsk();
      setCurrentContext(context);
      await mauzClient.setLensExpanded({ expanded: true });
      setMode("task");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const handleTalk = async (): Promise<void> => {
    setPendingAction("talk");
    setStatus(null);

    try {
      const context = await mauzClient.startTalk();
      setCurrentContext(context);
      setMode("talk");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  const authState = getOpenAiAuthState(settings);

  return (
    <section className="bubble-cluster-root" aria-label="Mauz menu">
      <h1 className="sr-only">MauzAI</h1>

      <button
        type="button"
        className="bubble-cluster-backdrop"
        aria-label="Close Mauz"
        tabIndex={-1}
        onClick={() => void mauzClient.close()}
      />

      <div className="bubble-cluster">
        <button
          type="button"
          className="bubble-hub"
          aria-label="Open Mauz Ask"
          disabled={pendingAction !== null}
          onClick={() => void handleLensAction("ask")}
        >
          <BrandLogo className="bubble-hub-logo" label="MauzAI" />
          <span
            className="bubble-auth-dot"
            data-status={authState}
            role="img"
            aria-label={
              authState === "connected"
                ? "OpenAI connected"
                : authState === "disconnected"
                  ? "OpenAI disconnected"
                  : "OpenAI not configured"
            }
          />
        </button>

        {LENS_ACTIONS.map((item, index) => {
          const Icon = item.icon;

          return (
            <button
              key={item.action}
              type="button"
              className="bubble"
              data-accent="answer"
              data-pending={pendingAction === item.action ? "true" : undefined}
              aria-label={item.detail}
              disabled={pendingAction !== null}
              onClick={() => void handleLensAction(item.action)}
              style={bubbleStyle(item.action, index)}
            >
              <Icon aria-hidden="true" size={18} />
              <span className="bubble-label" aria-hidden="true">
                {pendingAction === item.action ? "Capturing..." : item.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          className="bubble"
          data-accent="agent"
          data-pending={pendingAction === "task" ? "true" : undefined}
          aria-label="Work on this"
          disabled={pendingAction !== null}
          onClick={() => void handleTask()}
          style={bubbleStyle("task", 5)}
        >
          <BriefcaseBusiness aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            {pendingAction === "task" ? "Capturing..." : "Work on this"}
          </span>
        </button>

        <button
          type="button"
          className="bubble"
          data-pending={pendingAction === "talk" ? "true" : undefined}
          aria-label="Talk to Mauz"
          disabled={pendingAction !== null}
          onClick={() => void handleTalk()}
          style={bubbleStyle("talk", 5)}
        >
          <Mic aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            {pendingAction === "talk" ? "Opening voice..." : "Talk"}
          </span>
        </button>

        <button
          type="button"
          className="bubble"
          aria-label="Previous chats"
          disabled={pendingAction !== null}
          onClick={() => void handleHistory()}
          style={bubbleStyle("history", 6)}
        >
          <History aria-hidden="true" size={18} />
          <span className="bubble-label" aria-hidden="true">
            History
          </span>
        </button>

        <button
          type="button"
          className="bubble"
          data-size="sm"
          aria-label="Open Mauz settings"
          disabled={pendingAction !== null}
          onClick={() => void handleSettings()}
          style={bubbleStyle("settings", 7, 40)}
        >
          <Settings aria-hidden="true" size={15} />
          <span className="bubble-label" aria-hidden="true">
            Settings
          </span>
        </button>
      </div>

      {authState !== "connected" ? (
        <button
          type="button"
          className="bubble-auth-pill"
          aria-label="Connect OpenAI"
          disabled={pendingAuthAction !== null}
          onClick={() => void handleOpenAiReconnect()}
        >
          <KeyRound aria-hidden="true" size={11} />
          {pendingAuthAction === "connect" ? "Opening..." : `${getOpenAiAuthActionLabel(settings)} OpenAI`}
        </button>
      ) : null}

      {status !== null ? (
        <p className="bubble-status-toast" role="status" aria-live="polite">
          {status}
        </p>
      ) : null}
    </section>
  );
}

function getOpenAiAuthState(settings: MauzSettings | null): "connected" | "disconnected" | "missing" {
  if (settings?.apiKeyConfigured === true) {
    return "connected";
  }

  if (settings?.openAiAuthDisconnected === true) {
    return "disconnected";
  }

  return "missing";
}

function getOpenAiAuthActionLabel(settings: MauzSettings | null): string {
  if (settings?.apiKeyConfigured === true || settings?.openAiAuthDisconnected === true) {
    return "Reconnect";
  }

  return "Connect";
}

function getOpenAiReconnectMessage(settings: MauzSettings): string {
  if (settings.openAiCredentialSource === "saved") {
    return "OpenAI reconnected with saved key.";
  }

  if (settings.openAiCredentialSource === "environment") {
    return "OpenAI reconnected with launch key.";
  }

  return "OpenAI reconnected.";
}
