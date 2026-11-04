import {
  ArrowLeft,
  Check,
  Cpu,
  KeyRound,
  Lock,
  MousePointerClick,
  RefreshCw,
  Save,
  Server,
  Settings2,
  ShieldOff,
  Sparkles,
  Trash2,
  Zap
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AiFallbackPreference,
  AiProviderId,
  AiProviderPreference,
  AiProvidersStatusResponse,
  GatewayReadinessResult,
  MauzSettings,
  MauzSettingsUpdate,
  ShakeSensitivity,
  SubscriptionConnectState,
  SubscriptionProviderId,
  TalkEngine
} from "@mauzai/shared";
import { DEFAULT_HERMES_BASE_URL, MAX_CAPTURE_BLOCKED_APPS } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";
import {
  isConnecting,
  isSubscriptionProvider,
  SubscriptionButton,
  SubscriptionSignIn
} from "./SubscriptionConnect";

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
const TALK_ENGINE_OPTIONS: Array<{ value: TalkEngine; label: string }> = [
  { value: "pipeline", label: "Push to talk (uses your AI provider)" },
  { value: "realtime", label: "OpenAI Realtime voice (OpenAI key)" }
];
const ASK_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4-mini", "gpt-5.4", "gpt-5.4-nano"];
const TITLE_MODEL_OPTIONS = ["gpt-5.5", "gpt-5.4-nano", "gpt-5.4-mini"];
const UPCOMING_PROVIDER_OPTIONS = [
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
  // Edited as free text so typing a new line is not normalized away; parsed on Save.
  const [blockedAppsDraft, setBlockedAppsDraft] = useState(formatAppList(settings?.captureBlockedApps));
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [clearSavedOpenAiApiKey, setClearSavedOpenAiApiKey] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [gatewayReadiness, setGatewayReadiness] = useState<GatewayReadinessResult | null>(null);
  const [gatewayReadinessLoading, setGatewayReadinessLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<AiProvidersStatusResponse | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [anthropicApiKeyDraft, setAnthropicApiKeyDraft] = useState("");
  const [clearSavedAnthropicApiKey, setClearSavedAnthropicApiKey] = useState(false);
  const [connectStates, setConnectStates] = useState<
    Partial<Record<SubscriptionProviderId, SubscriptionConnectState>>
  >({});
  const [providerActionBusy, setProviderActionBusy] = useState(false);
  const [providerActionError, setProviderActionError] = useState<string | null>(null);
  const openAiApiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const gatewayReadinessRequestRef = useRef(0);

  const loadProvidersStatus = useCallback(async (refresh: boolean): Promise<void> => {
    setProvidersLoading(true);

    try {
      setProvidersStatus(await mauzClient.getProvidersStatus({ refresh }));
    } catch {
      setProvidersStatus(null);
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProvidersStatus(false);
  }, [loadProvidersStatus]);

  useEffect(
    () =>
      mauzClient.onSubscriptionConnectState((state) => {
        setConnectStates((current) => ({ ...current, [state.providerId]: state }));

        if (state.phase === "connected") {
          // The connector already refreshed detection, so the cached status is current.
          void loadProvidersStatus(false);
        }
      }),
    [loadProvidersStatus]
  );

  const connectSubscription = async (providerId: SubscriptionProviderId): Promise<void> => {
    setProviderActionError(null);

    try {
      const state = await mauzClient.connectSubscription(providerId);
      setConnectStates((current) => ({ ...current, [providerId]: state }));
    } catch (error) {
      setProviderActionError(error instanceof Error ? error.message : "Could not start sign-in.");
    }
  };

  const cancelSubscriptionConnect = (state: SubscriptionConnectState): void => {
    void mauzClient.cancelSubscriptionConnect(state.connectId).catch(() => {});
    setConnectStates((current) => ({ ...current, [state.providerId]: undefined }));
  };

  const disconnectSubscription = async (providerId: SubscriptionProviderId): Promise<void> => {
    setProviderActionBusy(true);
    setProviderActionError(null);

    try {
      setProvidersStatus(await mauzClient.disconnectSubscription(providerId));
      setConnectStates((current) => ({ ...current, [providerId]: undefined }));
    } catch (error) {
      setProviderActionError(error instanceof Error ? error.message : "Could not sign out.");
    } finally {
      setProviderActionBusy(false);
    }
  };

  useEffect(() => {
    setDraft(settings);
    setBlockedAppsDraft(formatAppList(settings?.captureBlockedApps));
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

  useEffect(() => {
    const requestId = gatewayReadinessRequestRef.current + 1;
    gatewayReadinessRequestRef.current = requestId;
    setGatewayReadinessLoading(true);

    void mauzClient
      .getGatewayReadinessStatus()
      .then((result) => {
        if (gatewayReadinessRequestRef.current === requestId) {
          setGatewayReadiness(result);
        }
      })
      .catch(() => {
        if (gatewayReadinessRequestRef.current === requestId) {
          setGatewayReadiness({
            status: "unavailable",
            message: "Gateway readiness could not be checked."
          });
        }
      })
      .finally(() => {
        if (gatewayReadinessRequestRef.current === requestId) {
          setGatewayReadinessLoading(false);
        }
      });

    return () => {
      if (gatewayReadinessRequestRef.current === requestId) {
        gatewayReadinessRequestRef.current += 1;
      }
    };
  }, [settings?.assistantMode, settings?.backendBaseUrl]);

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

  const focusOpenAiApiKeyInput = (): void => {
    requestAnimationFrame(() => {
      openAiApiKeyInputRef.current?.focus();
    });
  };

  const handleOpenAiReconnect = async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    if (draft.apiKeyConfigured && !draft.openAiAuthDisconnected) {
      setSettingsMessage("Paste a new OpenAI API key, then Save to reconnect.");
      focusOpenAiApiKeyInput();
      return;
    }

    setSaving(true);
    setSettingsMessage(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        openAiAuthDisconnected: false
      });

      setSettings(nextSettings);
      setDraft(nextSettings);
      setOpenAiApiKeyDraft("");
      setClearSavedOpenAiApiKey(false);

      if (nextSettings.apiKeyConfigured) {
        setSettingsMessage(getOpenAiReconnectMessage(nextSettings));
      } else {
        setSettingsMessage("Enter an OpenAI API key, then Save.");
        focusOpenAiApiKeyInput();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not reconnect OpenAI.";

      setSettingsMessage(message);
      setStatus(message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAiDisconnect = async (): Promise<void> => {
    if (draft === null) {
      return;
    }

    setSaving(true);
    setSettingsMessage(null);

    try {
      const nextSettings = await mauzClient.updateSettings({
        openAiAuthDisconnected: true
      });

      setSettings(nextSettings);
      setDraft(nextSettings);
      setOpenAiApiKeyDraft("");
      setClearSavedOpenAiApiKey(false);
      setSettingsMessage("OpenAI disconnected. Reconnect here or from the Mauz menu.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not disconnect OpenAI.";

      setSettingsMessage(message);
      setStatus(message);
    } finally {
      setSaving(false);
    }
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
        openAiAuthDisconnected: draft.openAiAuthDisconnected,
        askModel: draft.askModel,
        chatTitleModel: draft.chatTitleModel,
        realtimeModel: draft.realtimeModel,
        realtimeVoice: draft.realtimeVoice,
        realtimeReasoningEffort: draft.realtimeReasoningEffort,
        captureBlockedApps: parseAppList(blockedAppsDraft),
        assistantMode: draft.assistantMode,
        backendBaseUrl: draft.backendBaseUrl,
        agentMode: draft.agentMode,
        aiProvider: draft.aiProvider,
        aiFallbackProvider: draft.aiFallbackProvider,
        talkEngine: draft.talkEngine
      };
      const trimmedApiKeyDraft = openAiApiKeyDraft.trim();
      const trimmedAnthropicApiKeyDraft = anthropicApiKeyDraft.trim();

      if (trimmedApiKeyDraft.length > 0) {
        update.openAiApiKey = trimmedApiKeyDraft;
      }

      if (clearSavedOpenAiApiKey) {
        update.clearOpenAiApiKey = true;
      }

      if (trimmedAnthropicApiKeyDraft.length > 0) {
        update.anthropicApiKey = trimmedAnthropicApiKeyDraft;
      }

      if (clearSavedAnthropicApiKey) {
        update.clearAnthropicApiKey = true;
      }

      const nextSettings = await mauzClient.updateSettings(update);
      setSettings(nextSettings);
      setOpenAiApiKeyDraft("");
      setClearSavedOpenAiApiKey(false);
      setAnthropicApiKeyDraft("");
      setClearSavedAnthropicApiKey(false);
      setSettingsMessage("Settings saved.");
      void loadProvidersStatus(false);
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

  // A fallback only makes sense once more than one provider is set up.
  const readyProviderCount = providersStatus?.providers.filter((provider) => provider.available).length ?? 0;
  const showFallbackChoice = readyProviderCount > 1 || draft.aiFallbackProvider !== "none";

  return (
    <section className="settings-panel" data-chrome={chrome} aria-label="Mauz settings">
      <SettingsHeader chrome={chrome} onBack={handleBack} />

      <div className="settings-content">
        <div className="settings-section">
          <div className="settings-label">
            <Sparkles aria-hidden="true" size={15} />
            <span>AI provider</span>
          </div>
          <label className="settings-field">
            <span>Default provider</span>
            <select
              value={draft.aiProvider}
              onChange={(event) => {
                const aiProvider = event.target.value as AiProviderPreference;
                updateDraft("aiProvider", aiProvider);

                if (aiProvider === draft.aiFallbackProvider) {
                  updateDraft("aiFallbackProvider", "none");
                }
              }}
            >
              {AI_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {showFallbackChoice ? (
            <label className="settings-field">
              <span>Fallback provider</span>
              <select
                value={draft.aiFallbackProvider}
                onChange={(event) =>
                  updateDraft("aiFallbackProvider", event.target.value as AiFallbackPreference)
                }
              >
                <option value="none">None</option>
                {AI_PROVIDER_CHOICES.filter((option) => option.value !== draft.aiProvider).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="auth-provider-list" aria-label="Detected AI providers" aria-busy={providersLoading}>
            {providersStatus === null ? (
              <p className="settings-helper">
                {providersLoading
                  ? "Checking Claude Code, Codex, and API keys..."
                  : "Provider status unavailable."}
              </p>
            ) : (
              providersStatus.providers.map((provider) => {
                const subscription = isSubscriptionProvider(provider.id) ? provider.id : null;
                const connectState = subscription === null ? undefined : connectStates[subscription];

                return (
                  <div
                    className="auth-provider-card"
                    data-status={provider.available ? "active" : "missing"}
                    key={provider.id}
                  >
                    <div>
                      <strong>{provider.label}</strong>
                      <span>
                        {connectState?.phase === "failed" && connectState.message !== null
                          ? connectState.message
                          : `${provider.detail} Model: ${provider.model}.`}
                      </span>
                    </div>
                    <div className="provider-side">
                      <span className="provider-status">
                        {provider.id === providersStatus.activeProviderId ? (
                          <>
                            <Check aria-hidden="true" size={12} />
                            In use
                          </>
                        ) : provider.id === providersStatus.fallbackProviderId ? (
                          "Fallback"
                        ) : provider.available ? (
                          "Ready"
                        ) : isConnecting(connectState) ? (
                          "Connecting"
                        ) : (
                          "Not set up"
                        )}
                      </span>
                      {subscription !== null ? (
                        <SubscriptionButton
                          provider={{ ...provider, id: subscription }}
                          state={connectState}
                          busy={providerActionBusy}
                          onConnect={() => void connectSubscription(subscription)}
                          onDisconnect={() => void disconnectSubscription(subscription)}
                        />
                      ) : null}
                    </div>
                    {connectState !== undefined && isConnecting(connectState) ? (
                      <SubscriptionSignIn
                        label={provider.id === "claude-code" ? "Claude Code" : "Codex"}
                        state={connectState}
                        onCancel={() => cancelSubscriptionConnect(connectState)}
                      />
                    ) : null}
                  </div>
                );
              })
            )}
            {providerActionError !== null ? (
              <p className="subscription-error">{providerActionError}</p>
            ) : null}
          </div>
          <div className="settings-inline-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={providersLoading}
              onClick={() => void loadProvidersStatus(true)}
            >
              <RefreshCw aria-hidden="true" size={12} />
              <span>{providersLoading ? "Checking" : "Check again"}</span>
            </button>
          </div>
          <p className="settings-helper">
            Connect a Claude Code or Codex subscription here, or add an API key below. With one provider set
            up, Mauz uses it. With several, pick a default and a fallback that answers when the default is not
            ready or fails.
          </p>
          <label className="settings-field api-key-field">
            <span>Anthropic API key</span>
            <input
              type="password"
              value={anthropicApiKeyDraft}
              placeholder={
                draft.anthropicKeyConfigured ? "Configured - enter a new key to replace" : "sk-ant-..."
              }
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setAnthropicApiKeyDraft(event.target.value);
                setClearSavedAnthropicApiKey(false);
              }}
            />
          </label>
          {draft.anthropicKeyConfigured ? (
            <div className="settings-inline-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={saving || clearSavedAnthropicApiKey}
                onClick={() => {
                  setAnthropicApiKeyDraft("");
                  setClearSavedAnthropicApiKey(true);
                  setSettingsMessage("Saved Anthropic key will be cleared on Save.");
                }}
              >
                <Trash2 aria-hidden="true" size={12} />
                <span>{clearSavedAnthropicApiKey ? "Marked clear" : "Clear saved key"}</span>
              </button>
            </div>
          ) : null}
          <label className="settings-field">
            <span>Talk uses</span>
            <select
              value={draft.talkEngine}
              onChange={(event) => updateDraft("talkEngine", event.target.value as TalkEngine)}
            >
              {TALK_ENGINE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="settings-section">
          <div className="settings-label">
            <KeyRound aria-hidden="true" size={15} />
            <span>OpenAI API key</span>
          </div>
          <div className="auth-provider-list" aria-label="Model provider login options">
            <div className="auth-provider-card" data-status={getOpenAiAuthState(draft)} key="OpenAI login">
              <div>
                <strong>OpenAI login</strong>
                <span>{getOpenAiProviderDescription(draft)}</span>
              </div>
              <div className="provider-side">
                <span className="provider-status">
                  {draft.apiKeyConfigured ? (
                    <>
                      <Check aria-hidden="true" size={12} />
                      Connected
                    </>
                  ) : (
                    <>
                      <Lock aria-hidden="true" size={12} />
                      {draft.openAiAuthDisconnected ? "Disconnected" : "Missing key"}
                    </>
                  )}
                </span>
                <div className="provider-auth-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={saving}
                    onClick={() => void handleOpenAiReconnect()}
                  >
                    <KeyRound aria-hidden="true" size={11} />
                    <span>{getOpenAiAuthActionLabel(draft)}</span>
                  </button>
                  {draft.apiKeyConfigured ? (
                    <button
                      type="button"
                      className="danger-button"
                      disabled={saving}
                      onClick={() => void handleOpenAiDisconnect()}
                    >
                      <Lock aria-hidden="true" size={11} />
                      <span>Disconnect</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
            {UPCOMING_PROVIDER_OPTIONS.map((provider) => (
              <div className="auth-provider-card" data-status={provider.status} key={provider.name}>
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.description}</span>
                </div>
                <span className="provider-status">{provider.status}</span>
              </div>
            ))}
          </div>
          <label className="settings-field api-key-field">
            <span>API key</span>
            <input
              ref={openAiApiKeyInputRef}
              type="password"
              value={openAiApiKeyDraft}
              placeholder={draft.apiKeyConfigured ? "Configured - enter new key to reconnect" : "sk-..."}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setOpenAiApiKeyDraft(event.target.value);
                setClearSavedOpenAiApiKey(false);
                updateDraft("openAiAuthDisconnected", false);
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
          <div className="settings-label">
            <Server aria-hidden="true" size={15} />
            <span>Mode</span>
          </div>
          <div className="segmented-control" role="group" aria-label="Assistant mode">
            <button
              type="button"
              aria-pressed={draft.assistantMode === "simple"}
              onClick={() => updateDraft("assistantMode", "simple")}
            >
              Simple
            </button>
            <button
              type="button"
              aria-pressed={draft.assistantMode === "agentic"}
              onClick={() => updateDraft("assistantMode", "agentic")}
            >
              Agentic
            </button>
          </div>
          <p className="settings-helper">
            {draft.assistantMode === "simple"
              ? "Quick answers about what you're looking at."
              : "Use Work on this for supervised tasks that can use tools."}
          </p>
          {draft.assistantMode === "agentic" ? (
            <>
              <label className="settings-field">
                <span>Gateway URL</span>
                <input
                  type="text"
                  value={draft.backendBaseUrl}
                  placeholder={DEFAULT_HERMES_BASE_URL}
                  onChange={(event) => updateDraft("backendBaseUrl", event.target.value)}
                />
              </label>
              <p className="settings-helper" role="status" aria-live="polite">
                <strong>Gateway readiness:</strong>{" "}
                {settings?.assistantMode !== draft.assistantMode ||
                settings.backendBaseUrl !== draft.backendBaseUrl
                  ? "Save mode or Gateway URL changes to refresh readiness."
                  : gatewayReadinessLoading
                    ? "Checking gateway..."
                    : (gatewayReadiness?.message ?? "Gateway readiness is not available.")}
              </p>
              <SettingsSelect
                label="Agent mode"
                value={draft.agentMode}
                options={["approve", "yolo"]}
                onChange={(agentMode) => updateDraft("agentMode", agentMode as MauzSettings["agentMode"])}
              />
            </>
          ) : null}
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
        </div>

        <div className="settings-section">
          <div className="settings-label">
            <ShieldOff aria-hidden="true" size={15} />
            <span>Never capture</span>
          </div>
          <textarea
            className="settings-textarea"
            aria-label="Apps Mauz never captures"
            rows={4}
            spellCheck={false}
            value={blockedAppsDraft}
            onChange={(event) => setBlockedAppsDraft(event.target.value)}
          />
          <p className="settings-helper">
            One app per line: the program name on Windows (1Password.exe) or the bundle id on macOS. Mauz
            sends no screenshot, text, or window title from these apps.
          </p>
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

function formatAppList(apps: readonly string[] | undefined): string {
  return apps === undefined ? "" : apps.join("\n");
}

function parseAppList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, MAX_CAPTURE_BLOCKED_APPS);
}

function getOpenAiAuthState(settings: MauzSettings): "active" | "disconnected" | "missing" {
  if (settings.apiKeyConfigured) {
    return "active";
  }

  return settings.openAiAuthDisconnected ? "disconnected" : "missing";
}

function getOpenAiProviderDescription(settings: MauzSettings): string {
  if (settings.openAiAuthDisconnected) {
    return "OpenAI is disconnected. Reconnect to use a saved or launch key.";
  }

  if (settings.openAiCredentialSource === "saved") {
    return "Using the encrypted saved API key. Reconnect anytime with a new key.";
  }

  if (settings.openAiCredentialSource === "environment") {
    return "Using the launch environment key. Save a key here to reconnect without restarting.";
  }

  return "Connect with an OpenAI API key without restarting Mauz.";
}

function getOpenAiAuthActionLabel(settings: MauzSettings): string {
  if (settings.apiKeyConfigured || settings.openAiAuthDisconnected) {
    return "Reconnect";
  }

  return "Connect";
}

function getOpenAiReconnectMessage(settings: MauzSettings): string {
  if (settings.openAiCredentialSource === "saved") {
    return "OpenAI reconnected with the saved key.";
  }

  if (settings.openAiCredentialSource === "environment") {
    return "OpenAI reconnected with the launch key.";
  }

  return "OpenAI reconnected.";
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
          <h1 tabIndex={-1}>Settings</h1>
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
