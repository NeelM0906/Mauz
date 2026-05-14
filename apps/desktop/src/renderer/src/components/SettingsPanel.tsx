import { ArrowLeft, Check, MousePointerClick, Zap } from "lucide-react";
import type { ShakeSensitivity } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";

const SENSITIVITY_OPTIONS: Array<{
  value: ShakeSensitivity;
  label: string;
}> = [
  {
    value: "relaxed",
    label: "Relaxed"
  },
  {
    value: "normal",
    label: "Normal"
  },
  {
    value: "strict",
    label: "Strict"
  }
];

export function SettingsPanel(): React.JSX.Element {
  const { settings, setSettings, setStatus, backToMenu } = useMauzStore();

  const handleBack = async (): Promise<void> => {
    await mauzClient.showMenu();
    backToMenu();
  };

  const updateNativeShake = async (nativeShakeEnabled: boolean): Promise<void> => {
    try {
      const nextSettings = await mauzClient.updateSettings({
        nativeShakeEnabled
      });
      setSettings(nextSettings);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update Mauz settings.");
    }
  };

  const updateSensitivity = async (shakeSensitivity: ShakeSensitivity): Promise<void> => {
    try {
      const nextSettings = await mauzClient.updateSettings({
        shakeSensitivity
      });
      setSettings(nextSettings);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not update Mauz settings.");
    }
  };

  return (
    <section className="settings-panel" aria-label="Mauz settings">
      <header className="settings-header">
        <button
          className="icon-button"
          type="button"
          aria-label="Back to Mauz menu"
          onClick={() => void handleBack()}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <div className="panel-title">
          <BrandLogo className="panel-title-logo" />
          <div>
            <h1>Settings</h1>
            <p>Mouse shake stays local.</p>
          </div>
        </div>
      </header>

      <div className="settings-section">
        <div className="settings-row">
          <MousePointerClick aria-hidden="true" size={16} />
          <div>
            <strong>Native shake</strong>
            <span>Dev hotkey remains available.</span>
          </div>
          <button
            className="toggle-button"
            type="button"
            aria-pressed={settings?.nativeShakeEnabled ?? false}
            onClick={() => void updateNativeShake(!(settings?.nativeShakeEnabled ?? false))}
          >
            {(settings?.nativeShakeEnabled ?? false) ? <Check aria-hidden="true" size={14} /> : null}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-label">
          <Zap aria-hidden="true" size={15} />
          <span>Sensitivity</span>
        </div>
        <div className="segmented-control" role="group" aria-label="Shake sensitivity">
          {SENSITIVITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={settings?.shakeSensitivity === option.value}
              onClick={() => void updateSensitivity(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
