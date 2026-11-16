import React from "react";
import { createRoot } from "react-dom/client";
import { DictatePanel } from "./components/DictatePanel";
import { AskPanel } from "./components/AskPanel";
import { MauzMenu } from "./components/MauzMenu";
import { goBackToMenu } from "./components/PanelHeader";
import { SettingsPanel } from "./components/SettingsPanel";
import { TaskPanel } from "./components/TaskPanel";
import { mauz } from "./lib/mauzClient";
import { useMauzStore, type MauzMode } from "./state/useMauzStore";
import "./styles.css";

const PANELS: Record<MauzMode, React.ComponentType> = {
  menu: MauzMenu,
  ask: AskPanel,
  task: TaskPanel,
  dictate: DictatePanel,
  settings: SettingsPanel
};

function App(): React.JSX.Element {
  const mode = useMauzStore((state) => state.mode);
  const reset = useMauzStore((state) => state.reset);
  const setMode = useMauzStore((state) => state.setMode);

  React.useEffect(() => {
    const unsubSession = mauz().ask.onSession((session) => {
      const state = useMauzStore.getState();
      if (session === null || state.askSession?.id === session.id) state.setAskSession(session);
    });
    const unsubResume = mauz().ask.onResume((session) => {
      const state = useMauzStore.getState();
      state.setAskSession(session, true);
      state.setMode("ask");
    });
    const unsubDelta = mauz().ask.onDelta(({ sessionId, requestId, text }) => {
      const state = useMauzStore.getState();
      const session = state.askSession;
      if (session?.id === sessionId && session.pending?.id === requestId) {
        state.setAskSession({ ...session, pending: { ...session.pending, partial: text } });
      }
    });
    return () => {
      unsubSession();
      unsubResume();
      unsubDelta();
    };
  }, []);

  React.useEffect(() => {
    return mauz().events.onActivation(() => {
      reset();
    });
  }, [reset]);

  React.useEffect(() => {
    return mauz().events.onOpenSettings(() => {
      reset();
      setMode("settings");
    });
  }, [reset, setMode]);

  React.useEffect(() => {
    return mauz().events.onPermissionError((error) => {
      useMauzStore.getState().setStatus(error.message);
    });
  }, []);

  // Focus the primary heading of the newly mounted panel on each mode switch
  React.useEffect(() => {
    if (mode === "ask") return;
    const el = document.querySelector<HTMLElement>('h1[tabindex="-1"]');
    el?.focus();
  }, [mode]);

  // Global Escape key: step back (panel → menu) or close (menu → closed)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      // Don't intercept Escape while the user is composing text
      if (e.isComposing || (mode !== "ask" && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")))
        return;
      const state = useMauzStore.getState();
      if (state.mode === "menu") {
        void mauz().menu.close();
      } else {
        void goBackToMenu();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mode]);

  const Panel = PANELS[mode];
  return <Panel />;
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root element.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
