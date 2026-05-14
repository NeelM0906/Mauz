import { ArrowLeft, Check, Cpu, KeyRound, MousePointerClick, Save, Settings2, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import type { MauzSettings, RealtimeReasoningEffort, ShakeSensitivity } from "@mauzai/shared";
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

const ASK_MODEL_OPTIONS = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.4-nano"];
const TITLE_MODEL_OPTIONS = ["gpt-5.4-nano", "gpt-5.4-mini"];
const REALTIME_MODEL_OPTIONS = ["gpt-realtime-2", "gpt-realtime-mini"];
const VOICE_OPTIONS = ["marin", "cedar", "alloy"];
const REASONING_OPTIONS: RealtimeReasoningEffort[] = ["low", "medium", "high"];

type SettingsPanelProps = {
  chrome?: "popover" | "desktop";
};

export function SettingsPanel({ chrome = "popover" }: SettingsPanelProps = {}): React.JSX.Element {
  const { settings, setSettings, setStatus, backToMenu } = useMauzStore();
  const [draft, setDraft] = useState<MauzSettings | null>(settings);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    let disposed = false;

    const loadSettings = async (): Promise<void> => {
      try {
        const nextSettings = await mauzClient.openSettings();

        if (!disposed) {
          setSettings(nextSettings);
          setDraft(nextSettings);
        }
      } catch (error) {
        if (!disposed) {
          setSettingsMessage(error instanceof Error ? error.message : "Could not load Mauz settings.");
        }
      }
    };

    if (settings === null) {
      void loadSettings();
    }

    return () => {
      disposed = true;
    };
  }, [setSettings, settings]);

  const handleBack = async (): Promise<void> => {
    if (chrome === "desktop") {
      return;
    }

    await mauzClient.showMenu();
    backToMenu();
  };

  const updateDraft = <Key extends keyof MauzSettings>(key: Key, value: MauzSettings[Key]): void => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
  };

  const handleSave = async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    setSaving(true);
    setSettingsMessage(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        nativeShakeEnabled: draft.nativeShakeEnabled,
        devHotkeyEnabled: draft.devHotkeyEnabled,
        shakeSensitivity: draft.shakeSensitivity,
        askModel: draft.askModel,
        chatTitleModel: draft.chatTitleModel,
        realtimeModel: draft.realtimeModel,
        realtimeVoice: draft.realtimeVoice,
        realtimeReasoningEffort: draft.realtimeReasoningEffort,
        includeFullScreenshot: draft.includeFullScreenshot,
        ...(apiKeyInput.trim().length > 0 ? { openAiApiKey: apiKeyInput.trim() } : {})
      });
      setSettings(nextSettings);
      setApiKeyInput("");
      setSettingsMessage("Settings saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update Mauz settings.";

      setSettingsMessage(message);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const handleClearApiKey = async (): Promise<void> => {
    setSaving(true);
    setSettingsMessage(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        openAiApiKey: null
      });
      setSettings(nextSettings);
      setApiKeyInput("");
      setSettingsMessage("API key cleared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not clear the API key.";

      setSettingsMessage(message);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  };

  if (draft === null) {
    return (
      <section className="settings-panel" data-chrome={chrome} aria-label="Mauz settings">
        <SettingsHeader chrome={chrome} onBack={handleBack} />
        <p className="settings-message">Loading settings...</p>
      </section>
    );
  }

  return (
    <section className="settings-panel" data-chrome={chrome} aria-label="Mauz settings">
      <SettingsHeader chrome={chrome} onBack={handleBack} />

      <div className="settings-content">
        <div className="settings-section">
          <div className="settings-label">
            <KeyRound aria-hidden="true" size={15} />
            <span>OpenAI</span>
          </div>
          <label className="settings-field">
            <span>API key</span>
            <input
              type="password"
              value={apiKeyInput}
              placeholder={draft.apiKeyConfigured ? "Saved" : "Paste key"}
              autoComplete="off"
              onChange={(event) => setApiKeyInput(event.target.value)}
            />
          </label>
          <div className="settings-inline-actions">
            <button type="button" className="secondary-button" onClick={() => void handleClearApiKey()}>
              Clear key
            </button>
          </div>
        </div>

        <div className="settings-section">
          <div className="settings-label">
            <Cpu aria-hidden="true" size={15} />
            <span>Models</span>
          </div>
          <SettingsSelect
            label="Ask"
            value={draft.askModel}
            options={ASK_MODEL_OPTIONS}
            onChange={(askModel) => updateDraft("askModel", askModel)}
          />
          <SettingsSelect
            label="Titles"
            value={draft.chatTitleModel}
            options={TITLE_MODEL_OPTIONS}
            onChange={(chatTitleModel) => updateDraft("chatTitleModel", chatTitleModel)}
          />
          <SettingsSelect
            label="Realtime"
            value={draft.realtimeModel}
            options={REALTIME_MODEL_OPTIONS}
            onChange={(realtimeModel) => updateDraft("realtimeModel", realtimeModel)}
          />
          <SettingsSelect
            label="Voice"
            value={draft.realtimeVoice}
            options={VOICE_OPTIONS}
            onChange={(realtimeVoice) => updateDraft("realtimeVoice", realtimeVoice)}
          />
          <SettingsSelect
            label="Reasoning"
            value={draft.realtimeReasoningEffort}
            options={REASONING_OPTIONS}
            onChange={(value) => updateDraft("realtimeReasoningEffort", value as RealtimeReasoningEffort)}
          />
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <MousePointerClick aria-hidden="true" size={16} />
            <div>
              <strong>Native shake</strong>
              <span>Starts the macOS helper after each launch.</span>
            </div>
            <ToggleButton
              pressed={draft.nativeShakeEnabled}
              onClick={() => updateDraft("nativeShakeEnabled", !draft.nativeShakeEnabled)}
            />
          </div>
          <div className="settings-row">
            <Settings2 aria-hidden="true" size={16} />
            <div>
              <strong>Dev hotkey</strong>
              <span>Command Shift M opens Mauz.</span>
            </div>
            <ToggleButton
              pressed={draft.devHotkeyEnabled}
              onClick={() => updateDraft("devHotkeyEnabled", !draft.devHotkeyEnabled)}
            />
          </div>
          <div className="settings-label">
            <Zap aria-hidden="true" size={15} />
            <span>Sensitivity</span>
          </div>
          <div className="segmented-control" role="group" aria-label="Shake sensitivity">
            {SENSITIVITY_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={draft.shakeSensitivity === option.value}
                onClick={() => updateDraft("shakeSensitivity", option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={draft.includeFullScreenshot}
              onChange={(event) => updateDraft("includeFullScreenshot", event.target.checked)}
            />
            <span>Include full screenshot with cursor crop</span>
          </label>
        </div>
      </div>

      <footer className="settings-footer">
        <span>{settingsMessage ?? "Changes apply after Save."}</span>
        <button type="button" className="submit-button" disabled={saving} onClick={() => void handleSave()}>
          <Save aria-hidden="true" size={15} />
          <span>{saving ? "Saving" : "Save"}</span>
        </button>
      </footer>
    </section>
  );
}

function SettingsHeader({
  chrome,
  onBack
}: {
  chrome: "popover" | "desktop";
  onBack(): Promise<void>;
}): React.JSX.Element {
  return (
    <header className="settings-header">
      {chrome === "popover" ? (
        <button
          className="icon-button"
          type="button"
          aria-label="Back to Mauz menu"
          onClick={() => void onBack()}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
      ) : null}
      <div className="panel-title">
        <BrandLogo className="panel-title-logo" />
        <div>
          <h1>Settings</h1>
          <p>Models, key, and activation.</p>
        </div>
      </div>
    </header>
  );
}

function SettingsSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange(value: string): void;
}): React.JSX.Element {
  const selectOptions = options.includes(value) ? options : [value, ...options];

  return (
    <label className="settings-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {selectOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleButton({ pressed, onClick }: { pressed: boolean; onClick(): void }): React.JSX.Element {
  return (
    <button className="toggle-button" type="button" aria-pressed={pressed} onClick={onClick}>
      {pressed ? <Check aria-hidden="true" size={14} /> : null}
    </button>
  );
}
