import React from "react";
import { createRoot } from "react-dom/client";
import { MauzMenu } from "./components/MauzMenu";
import { mauzClient } from "./lib/mauzClient";
import { useMauzStore } from "./state/useMauzStore";
import "./styles.css";

function App(): React.JSX.Element {
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
