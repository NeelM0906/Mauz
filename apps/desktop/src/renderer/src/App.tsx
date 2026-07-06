import React from "react";
import { createRoot } from "react-dom/client";
import { ChatHistoryPanel } from "./components/ChatHistoryPanel";
import { DesktopApp } from "./components/DesktopApp";
import { LensPanel } from "./components/LensPanel";
import { MauzMenu } from "./components/MauzMenu";
import { SettingsPanel } from "./components/SettingsPanel";
import { TalkPanel } from "./components/TalkPanel";
import { mauzClient } from "./lib/mauzClient";
import { useMauzStore } from "./state/useMauzStore";
import "./styles.css";

function App(): React.JSX.Element {
  const surface = getRendererSurface();
  const mode = useMauzStore((state) => state.mode);
  const reset = useMauzStore((state) => state.reset);

  React.useEffect(() => {
    if (surface === "desktop") {
      return;
    }

    return mauzClient.onActivation(() => {
      reset();
    });
  }, [reset, surface]);

  React.useEffect(() => {
    return mauzClient.onPermissionError((error) => {
      useMauzStore.getState().setStatus(error.message);
    });
  }, []);

  // Focus the primary heading of the newly mounted panel on each mode switch
  React.useEffect(() => {
    if (surface === "desktop") return;
    const el = document.querySelector<HTMLElement>('h1[tabindex="-1"]');
    el?.focus();
  }, [mode, surface]);

  // Global Escape key: step back (panel → menu) or close (menu → closed)
  React.useEffect(() => {
    if (surface === "desktop") return;

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
  }, [surface]);

  if (surface === "desktop") {
    return <DesktopApp />;
  }

  if (mode === "lens") {
    return <LensPanel />;
  }

  if (mode === "settings") {
    return <SettingsPanel />;
  }

  if (mode === "history") {
    return <ChatHistoryPanel allowContinue={false} />;
  }

  if (mode === "talk") {
    return <TalkPanel />;
  }

  return <MauzMenu />;
}

function getRendererSurface(): "desktop" | "popover" {
  const surface = new URLSearchParams(window.location.search).get("surface");

  return surface === "desktop" ? "desktop" : "popover";
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
