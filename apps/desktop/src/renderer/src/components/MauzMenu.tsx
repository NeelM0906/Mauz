import { MessageCircleQuestion, Mic, MonitorUp, Settings, X } from "lucide-react";
import { useState } from "react";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";

type MenuAction = "ask" | "talk" | "screen";

const actionCopy: Record<MenuAction, string> = {
  ask: "Ask Mauz",
  talk: "Talk to Mauz",
  screen: "Show Mauz my screen"
};

export function MauzMenu(): React.JSX.Element {
  const { status, setCurrentContext, setMode, setSettings, setStatus } = useMauzStore();
  const [pendingAction, setPendingAction] = useState<MenuAction | null>(null);

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

  const handleAction = async (action: MenuAction): Promise<void> => {
    setPendingAction(action);
    setStatus(null);

    try {
      if (action === "ask") {
        const context = await mauzClient.startAsk();
        setCurrentContext(context);
        setMode("ask");
      } else if (action === "talk") {
        const context = await mauzClient.startTalk();
        setCurrentContext(context);
        setMode("talk");
      } else {
        const context = await mauzClient.startScreenShare();
        setCurrentContext(context);
        setMode("screen");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Mauz action failed.");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <section className="mauz-panel" aria-label="Mauz menu">
      <header className="mauz-header">
        <div className="mauz-mark" aria-hidden="true">
          M
        </div>
        <div>
          <h1>MauzAI</h1>
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
          <span>Talk to Mauz</span>
        </button>
        <button
          type="button"
          className="mauz-action"
          onClick={() => void handleAction("screen")}
          disabled={pendingAction !== null}
        >
          <MonitorUp aria-hidden="true" size={18} />
          <span>Show Mauz my screen</span>
        </button>
      </div>

      <footer className="mauz-footer">
        <span>{status ?? "Mauz sees nothing until you choose an option."}</span>
      </footer>
    </section>
  );
}
