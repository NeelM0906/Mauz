import React from "react";
import { createRoot } from "react-dom/client";
import { AskPanel } from "./components/AskPanel";
import { ChatHistoryPanel } from "./components/ChatHistoryPanel";
import { DesktopApp } from "./components/DesktopApp";
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

  if (surface === "desktop") {
    return <DesktopApp />;
  }

  if (mode === "ask") {
    return <AskPanel />;
  }

  if (mode === "settings") {
    return <SettingsPanel />;
  }

  if (mode === "history") {
    return <ChatHistoryPanel allowContinue={false} />;
  }

  if (mode === "talk" || mode === "screen") {
    return <TalkPanel mode={mode} />;
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
