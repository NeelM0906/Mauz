import { Check, History, KeyRound, Lock, MessageCircleQuestion, Mic, Settings, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { MauzSettings } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

type MenuAction = "ask" | "talk";
type AuthAction = "connect" | "disconnect";

export function MauzMenu(): React.JSX.Element {
  const {
    settings,
    status,
    setChatHistory,
    setCurrentContext,
    setMode,
    setSelectedConversation,
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

  const handleOpenAiDisconnect = async (): Promise<void> => {
    setPendingAuthAction("disconnect");
    setStatus(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        openAiAuthDisconnected: true
      });

      setSettings(nextSettings);
      setStatus("OpenAI disconnected.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "OpenAI disconnect failed.");
    } finally {
      setPendingAuthAction(null);
    }
  };

  const handleAction = async (action: MenuAction): Promise<void> => {
    setPendingAction(action);
    setStatus(null);

    try {
      const context = action === "talk" ? await mauzClient.startTalk() : await mauzClient.startAsk();
      setCurrentContext(context);
      setMode(action);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="mauz-panel" aria-label="Mauz menu">
      <header className="mauz-header">
        <div className="mauz-brand">
          <BrandLogo className="mauz-brand-logo" />
          <h1 className="sr-only">MauzAI</h1>
          <p>Desktop help, on demand.</p>
        </div>
        <div className="mauz-header-actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Open Mauz settings"
            onClick={() => void handleSettings()}
          >
            <Settings aria-hidden="true" size={15} />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Close Mauz"
            onClick={() => void mauzClient.close()}
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      </header>

      <OpenAiAuthMenu
        settings={settings}
        pendingAuthAction={pendingAuthAction}
        onReconnect={handleOpenAiReconnect}
        onDisconnect={handleOpenAiDisconnect}
      />

      <div className="mauz-actions">
        <button
          type="button"
          className="mauz-action"
          onClick={() => void handleAction("ask")}
          disabled={pendingAction !== null}
        >
          <MessageCircleQuestion aria-hidden="true" size={18} />
          <span>{pendingAction === "ask" ? "Capturing screen..." : "Ask Mauz"}</span>
        </button>
        <button
          type="button"
          className="mauz-action"
          onClick={() => void handleAction("talk")}
          disabled={pendingAction !== null}
        >
          <Mic aria-hidden="true" size={18} />
          <span>{pendingAction === "talk" ? "Opening voice..." : "Talk to Mauz"}</span>
        </button>
        <button
          type="button"
          className="mauz-action"
          onClick={() => void handleHistory()}
          disabled={pendingAction !== null}
        >
          <History aria-hidden="true" size={18} />
          <span>Prev chats</span>
        </button>
      </div>

      <footer className="mauz-footer">
        <span>{status ?? "Mauz sees nothing until you choose an option."}</span>
      </footer>
    </section>
  );
}

function OpenAiAuthMenu({
  settings,
  pendingAuthAction,
  onReconnect,
  onDisconnect
}: {
  settings: MauzSettings | null;
  pendingAuthAction: AuthAction | null;
  onReconnect(): Promise<void>;
  onDisconnect(): Promise<void>;
}): React.JSX.Element {
  const authState = getOpenAiAuthState(settings);
  const canDisconnect = settings?.apiKeyConfigured === true;

  return (
    <div className="mauz-auth-card" data-status={authState} aria-label="OpenAI login controls">
      <div className="mauz-auth-summary">
        <KeyRound aria-hidden="true" size={14} />
        <div>
          <strong>OpenAI login</strong>
          <span>{getOpenAiAuthDescription(settings)}</span>
        </div>
        <span className="mauz-auth-status">
          {authState === "connected" ? (
            <>
              <Check aria-hidden="true" size={11} />
              Connected
            </>
          ) : (
            <>
              <Lock aria-hidden="true" size={11} />
              {authState === "disconnected" ? "Disconnected" : "Missing key"}
            </>
          )}
        </span>
      </div>
      <div className="mauz-auth-actions">
        <button
          type="button"
          className="menu-auth-button"
          disabled={pendingAuthAction !== null}
          onClick={() => void onReconnect()}
        >
          {pendingAuthAction === "connect" ? "Opening..." : getOpenAiAuthActionLabel(settings)}
        </button>
        {canDisconnect ? (
          <button
            type="button"
            className="menu-auth-button danger"
            disabled={pendingAuthAction !== null}
            onClick={() => void onDisconnect()}
          >
            {pendingAuthAction === "disconnect" ? "Disconnecting..." : "Disconnect"}
          </button>
        ) : null}
      </div>
    </div>
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

function getOpenAiAuthDescription(settings: MauzSettings | null): string {
  if (settings === null) {
    return "Checking login status.";
  }

  if (settings.openAiAuthDisconnected) {
    return "Reconnect saved or launch credentials.";
  }

  if (settings.openAiCredentialSource === "saved") {
    return "Using encrypted saved key.";
  }

  if (settings.openAiCredentialSource === "environment") {
    return "Using launch environment key.";
  }

  return "Connect from this menu.";
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
