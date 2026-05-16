import {
  ArrowLeft,
  Check,
  Cpu,
  KeyRound,
  Lock,
  MousePointerClick,
  Save,
  Settings2,
  Trash2,
  Zap
} from "lucide-react";
import { useEffect, useState } from "react";
import type { MauzSettings, MauzSettingsUpdate, ShakeSensitivity } from "@mauzai/shared";
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

const ASK_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gpt-5.4-nano"];
const TITLE_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4-nano", "gpt-5.4-mini"];
const PROVIDER_OPTIONS = [
  {
    name: "OpenAI login",
    status: "active",
    description: "Uses OpenAI credentials from the launch environment or an encrypted saved key."
  },
  {
    name: "z.ai",
    status: "coming soon",
    description: "Provider integration planned."
  },
  {
    name: "MiniMax",
    status: "coming soon",
    description: "Provider integration planned."
  },
  {
    name: "Kimi",
    status: "coming soon",
    description: "Provider integration planned."
  }
] as const;

type SettingsPanelProps = {
  chrome?: "popover" | "desktop";
};

export function SettingsPanel({ chrome = "popover" }: SettingsPanelProps = {}): React.JSX.Element {
  const { settings, setSettings, setStatus, backToMenu } = useMauzStore();
  const [draft, setDraft] = useState<MauzSettings | null>(settings);
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [clearSavedOpenAiApiKey, setClearSavedOpenAiApiKey] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
    setOpenAiApiKeyDraft("");
    setClearSavedOpenAiApiKey(false);
  }, [settings]);

  useEffect(() => {
    let disposed = false;

    const loadSettings = async (): Promise<void> => {
      try {
        const nextSettings = await mauzClient.openSettings();

        if (!disposed) {
          setSettings(nextSettings);
          setDraft(nextSettings);
          setOpenAiApiKeyDraft("");
          setClearSavedOpenAiApiKey(false);
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
      const update: MauzSettingsUpdate = {
        nativeShakeEnabled: draft.nativeShakeEnabled,
        devHotkeyEnabled: draft.devHotkeyEnabled,
        shakeSensitivity: draft.shakeSensitivity,
        askModel: draft.askModel,
        chatTitleModel: draft.chatTitleModel,
        realtimeModel: draft.realtimeModel,
        realtimeVoice: draft.realtimeVoice,
        realtimeReasoningEffort: draft.realtimeReasoningEffort,
        includeFullScreenshot: draft.includeFullScreenshot
      };
      const trimmedApiKeyDraft = openAiApiKeyDraft.trim();

      if (trimmedApiKeyDraft.length > 0) {
        update.openAiApiKey = trimmedApiKeyDraft;
      }

      if (clearSavedOpenAiApiKey) {
        update.clearOpenAiApiKey = true;
      }

      const nextSettings = await mauzClient.updateSettings(update);
      setSettings(nextSettings);
      setOpenAiApiKeyDraft("");
      setClearSavedOpenAiApiKey(false);
      setSettingsMessage("Settings saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update Mauz settings.";

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
            <span>Login</span>
          </div>
          <div className="auth-provider-list" aria-label="Model provider login options">
            {PROVIDER_OPTIONS.map((provider) => (
              <div className="auth-provider-card" data-status={provider.status} key={provider.name}>
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.description}</span>
                </div>
                <span className="provider-status">
                  {provider.status === "active" ? (
                    draft.apiKeyConfigured ? (
                      <>
                        <Check aria-hidden="true" size={12} />
                        Connected
                      </>
                    ) : (
                      <>
                        <Lock aria-hidden="true" size={12} />
                        Missing key
                      </>
                    )
                  ) : (
                    provider.status
                  )}
                </span>
              </div>
            ))}
          </div>
          <label className="settings-field api-key-field">
            <span>API key</span>
            <input
              type="password"
              value={openAiApiKeyDraft}
              placeholder={draft.apiKeyConfigured ? "Configured - enter new key to replace" : "sk-..."}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setOpenAiApiKeyDraft(event.target.value);
                setClearSavedOpenAiApiKey(false);
              }}
            />
          </label>
          <div className="settings-inline-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={saving || clearSavedOpenAiApiKey}
              onClick={() => {
                setOpenAiApiKeyDraft("");
                setClearSavedOpenAiApiKey(true);
                setSettingsMessage("Saved OpenAI key will be cleared on Save.");
              }}
            >
              <Trash2 aria-hidden="true" size={12} />
              <span>{clearSavedOpenAiApiKey ? "Marked clear" : "Clear saved key"}</span>
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
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <MousePointerClick aria-hidden="true" size={16} />
            <div>
              <strong>Native shake</strong>
              <span>Starts the macOS helper. Requires Accessibility permission.</span>
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
          <p>Models and activation.</p>
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
