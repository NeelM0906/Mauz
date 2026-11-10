import { ArrowLeft, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { AiProviderId, AiProviderPreference, MauzSettings } from "@mauzai/shared";
import { mauz } from "@renderer/lib/mauzClient";
import {
  buildSettingsUpdate,
  EMPTY_KEY_DRAFTS,
  formatAppList,
  type ApiKeyDrafts,
  type ApiKeyId,
  type BlockedListText
} from "@renderer/lib/settingsUpdate";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { AiProviderList, useAiProviders } from "./AiProviders";
import { BrandLogo } from "./BrandLogo";
import { goBackToMenu } from "./PanelHeader";
import {
  ActivationSection,
  ApiKeyField,
  BrowserExtensionSection,
  NeverCaptureSection,
  TaskAgentSection,
  type UpdateDraft,
  useLoadOnMount
} from "./SettingsSections";

const AI_PROVIDER_CHOICES: Array<{ value: AiProviderId; label: string }> = [
  { value: "claude-code", label: "Claude Code subscription" },
  { value: "codex", label: "Codex (ChatGPT) subscription" },
  { value: "anthropic", label: "Anthropic API key" },
  { value: "openai", label: "OpenAI API key" }
];
const AI_PROVIDER_OPTIONS: Array<{ value: AiProviderPreference; label: string }> = [
  { value: "auto", label: "Automatic (whichever is set up)" },
  ...AI_PROVIDER_CHOICES
];

const API_KEY_FIELDS: Array<{
  id: ApiKeyId;
  label: string;
  vendor: string;
  placeholder: string;
  isConfigured(settings: MauzSettings): boolean;
}> = [
  {
    id: "anthropic",
    label: "Anthropic API key",
    vendor: "Anthropic",
    placeholder: "sk-ant-...",
    isConfigured: (settings) => settings.anthropicKeyConfigured
  },
  {
    id: "openai",
    label: "OpenAI API key",
    vendor: "OpenAI",
    placeholder: "sk-...",
    isConfigured: (settings) => settings.apiKeyConfigured
  }
];

export function SettingsPanel(): React.JSX.Element {
  const { settings, setSettings, setStatus } = useMauzStore();
  const [draft, setDraft] = useState<MauzSettings | null>(settings);
  const [blocked, setBlocked] = useState<BlockedListText>(toBlockedListText(settings));
  const [keyDrafts, setKeyDrafts] = useState<ApiKeyDrafts>(EMPTY_KEY_DRAFTS);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const providers = useAiProviders();
  // Loaded once when the panel opens, as before the split; the sections render only after settings load.
  const taskAgents = useLoadOnMount(async () => (await mauz().task.agents()).agents);
  const browserStatus = useLoadOnMount(() => mauz().browser.status());

  // Each new settings value (loaded or saved) resets the drafts. With none, load them: the store
  // has none after an activation or a tray open, so the main process's changes show here.
  useEffect(() => {
    setDraft(settings);
    setBlocked(toBlockedListText(settings));
    setKeyDrafts(EMPTY_KEY_DRAFTS);

    if (settings !== null) {
      return;
    }

    let disposed = false;

    void mauz()
      .settings.open()
      .then(
        (nextSettings) => {
          if (!disposed) {
            setSettings(nextSettings);
          }
        },
        (error: unknown) => {
          if (!disposed) {
            setSettingsMessage(error instanceof Error ? error.message : "Could not load Mauz settings.");
          }
        }
      );

    return () => {
      disposed = true;
    };
  }, [setSettings, settings]);

  const updateDraft: UpdateDraft = (key, value) => {
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));
  };

  const handleSave = async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    setSaving(true);
    setSettingsMessage(null);

    try {
      // The new settings value resets the drafts (effect above).
      setSettings(await mauz().settings.update(buildSettingsUpdate(draft, keyDrafts, blocked)));
      setSettingsMessage("Settings saved.");
      void providers.load(false);
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
      <section className="settings-panel" aria-label="Mauz settings">
        <SettingsHeader />
        <p className="settings-message">{settingsMessage ?? "Loading settings..."}</p>
      </section>
    );
  }

  return (
    <section className="settings-panel" aria-label="Mauz settings">
      <SettingsHeader />

      <div className="settings-content">
        <div className="settings-section">
          <div className="settings-label">
            <Sparkles aria-hidden="true" size={15} />
            <span>General AI</span>
          </div>
          <p className="settings-helper">Answers Ask, including questions you dictate.</p>
          <label className="settings-field">
            <span>Default provider</span>
            <select
              value={draft.aiProvider}
              onChange={(event) => updateDraft("aiProvider", event.target.value as AiProviderPreference)}
            >
              {AI_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <AiProviderList providers={providers} />
          <p className="settings-helper">
            Connect a Claude Code or Codex subscription here, or add an API key below. With one provider set
            up, Mauz uses it. With several, pick the default.
          </p>
          {API_KEY_FIELDS.map((field) => (
            <ApiKeyField
              key={field.id}
              label={field.label}
              placeholder={field.placeholder}
              configured={field.isConfigured(draft)}
              draft={keyDrafts[field.id]}
              saving={saving}
              onChange={(value) => {
                setKeyDrafts((current) => ({ ...current, [field.id]: { value, clear: false } }));
              }}
              onClear={() => {
                setKeyDrafts((current) => ({ ...current, [field.id]: { value: "", clear: true } }));
                setSettingsMessage(`Saved ${field.vendor} key will be cleared on Save.`);
              }}
            />
          ))}
        </div>

        <TaskAgentSection draft={draft} updateDraft={updateDraft} taskAgents={taskAgents} />
        <ActivationSection draft={draft} updateDraft={updateDraft} />
        <NeverCaptureSection blocked={blocked} onChange={setBlocked} />
        <BrowserExtensionSection browserStatus={browserStatus} />
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

function toBlockedListText(settings: MauzSettings | null): BlockedListText {
  return {
    apps: formatAppList(settings?.captureBlockedApps),
    sites: formatAppList(settings?.captureBlockedSites)
  };
}

function SettingsHeader(): React.JSX.Element {
  return (
    <header className="settings-header">
      <button
        className="icon-button"
        type="button"
        aria-label="Back to Mauz menu"
        onClick={() => void goBackToMenu()}
      >
        <ArrowLeft aria-hidden="true" size={16} />
      </button>
      <div className="panel-title">
        <BrandLogo className="panel-title-logo" />
        <div>
          <h1 tabIndex={-1}>Settings</h1>
          <p>Models and activation.</p>
        </div>
      </div>
    </header>
  );
}
