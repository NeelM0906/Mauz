import React from "react";
import { createRoot } from "react-dom/client";
import { DictatePanel } from "./components/DictatePanel";
import { LensPanel } from "./components/LensPanel";
import { MauzMenu } from "./components/MauzMenu";
import { SettingsPanel } from "./components/SettingsPanel";
import { TaskPanel } from "./components/TaskPanel";
import { mauzClient } from "./lib/mauzClient";
import { useMauzStore } from "./state/useMauzStore";
import "./styles.css";

function App(): React.JSX.Element {
  const mode = useMauzStore((state) => state.mode);
  const reset = useMauzStore((state) => state.reset);
  const setMode = useMauzStore((state) => state.setMode);

  React.useEffect(() => {
    return mauzClient.onActivation(() => {
      reset();
    });
  }, [reset]);

  React.useEffect(() => {
    return mauzClient.onOpenSettings(() => {
      reset();
      setMode("settings");
    });
  }, [reset, setMode]);

  React.useEffect(() => {
    return mauzClient.onPermissionError((error) => {
      useMauzStore.getState().setStatus(error.message);
    });
  }, []);

  // Focus the primary heading of the newly mounted panel on each mode switch
  React.useEffect(() => {
    const el = document.querySelector<HTMLElement>('h1[tabindex="-1"]');
    el?.focus();
  }, [mode]);

  // Global Escape key: step back (panel → menu) or close (menu → closed)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      const target = e.target as HTMLElement;
      // Don't intercept Escape while the user is composing text
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      const state = useMauzStore.getState();
      if (state.mode === "menu") {
        void mauzClient.close();
      } else {
        void mauzClient.showMenu();
        state.backToMenu();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (mode === "lens") {
    return <LensPanel />;
  }

  if (mode === "task") {
    return <TaskPanel />;
  }

  if (mode === "dictate") {
    return <DictatePanel />;
  }

  if (mode === "settings") {
    return <SettingsPanel />;
  }

  return <MauzMenu />;
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
