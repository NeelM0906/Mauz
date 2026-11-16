import { ArrowLeft, X } from "lucide-react";
import { mauz } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

/** Shrinks the popover to the menu size, then shows the menu, even if the resize failed. */
export async function goBackToMenu(): Promise<void> {
  try {
    await mauz().menu.showMenu();
  } finally {
    useMauzStore.getState().backToMenu();
  }
}

/** Header of the Ask, Send to agent and Dictate panels. `onLeave` runs before Back and Close. */
export function PanelHeader({
  title,
  subtitle,
  onLeave,
  action
}: {
  title: string;
  subtitle: string;
  onLeave?: () => void;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="mode-header">
      <button
        className="icon-button"
        type="button"
        aria-label="Back to Mauz menu"
        onClick={() => {
          onLeave?.();
          void goBackToMenu();
        }}
      >
        <ArrowLeft aria-hidden="true" size={16} />
      </button>
      <div className="panel-title">
        <BrandLogo className="panel-title-logo" />
        <div>
          <h1 tabIndex={-1}>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="panel-header-actions">
        {action}
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => {
            onLeave?.();
            void mauz().menu.close();
          }}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </header>
  );
}
