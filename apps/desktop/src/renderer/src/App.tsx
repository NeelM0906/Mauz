import React from "react";
import { createRoot } from "react-dom/client";
import { AskPanel } from "./components/AskPanel";
import { MauzMenu } from "./components/MauzMenu";
import { SettingsPanel } from "./components/SettingsPanel";
import { mauzClient } from "./lib/mauzClient";
import { useMauzStore } from "./state/useMauzStore";
import "./styles.css";

function App(): React.JSX.Element {
  const mode = useMauzStore((state) => state.mode);
  const reset = useMauzStore((state) => state.reset);

  React.useEffect(() => {
    return mauzClient.onActivation(() => {
      reset();
    });
  }, [reset]);

  React.useEffect(() => {
    return mauzClient.onPermissionError((error) => {
      useMauzStore.getState().setStatus(error.message);
    });
  }, []);

  if (mode === "ask") {
    return <AskPanel />;
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
