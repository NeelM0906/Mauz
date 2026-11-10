import { Check, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type {
  AiProvidersStatusResponse,
  SubscriptionConnectState,
  SubscriptionProviderId
} from "@mauzai/shared";
import { mauz } from "@renderer/lib/mauzClient";
import {
  isConnecting,
  isSubscriptionProvider,
  SubscriptionButton,
  SubscriptionSignIn
} from "./SubscriptionConnect";

export type AiProviders = ReturnType<typeof useAiProviders>;

/** Detected AI providers and the subscription sign-in and sign-out flows. */
export function useAiProviders() {
  const [status, setStatus] = useState<AiProvidersStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [connectStates, setConnectStates] = useState<
    Partial<Record<SubscriptionProviderId, SubscriptionConnectState>>
  >({});
  const [action, setAction] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    setLoading(true);

    try {
      setStatus(await mauz().providers.status({ refresh }));
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(
    () =>
      mauz().providers.onConnectState((state) => {
        setConnectStates((current) => ({ ...current, [state.providerId]: state }));

        if (state.phase === "connected") {
          // The connector already refreshed detection, so the cached status is current.
          void load(false);
        }
      }),
    [load]
  );

  const connect = async (providerId: SubscriptionProviderId): Promise<void> => {
    setAction((current) => ({ ...current, error: null }));

    try {
      const state = await mauz().providers.connect({ providerId });
      setConnectStates((current) => ({ ...current, [providerId]: state }));
    } catch (error) {
      setAction((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "Could not start sign-in."
      }));
    }
  };

  const cancel = (state: SubscriptionConnectState): void => {
    void mauz()
      .providers.cancelConnect({ connectId: state.connectId })
      .catch(() => {});
    setConnectStates((current) => ({ ...current, [state.providerId]: undefined }));
  };

  const disconnect = async (providerId: SubscriptionProviderId): Promise<void> => {
    setAction({ busy: true, error: null });

    try {
      setStatus(await mauz().providers.disconnect({ providerId }));
      setConnectStates((current) => ({ ...current, [providerId]: undefined }));
      setAction({ busy: false, error: null });
    } catch (error) {
      setAction({ busy: false, error: error instanceof Error ? error.message : "Could not sign out." });
    }
  };

  return { status, loading, connectStates, action, load, connect, cancel, disconnect };
}

/** The subscription cards and the "Check again" button. */
export function AiProviderList({ providers }: { providers: AiProviders }): React.JSX.Element {
  const { status, loading, connectStates, action } = providers;

  return (
    <>
      <div className="auth-provider-list" aria-label="Detected AI providers" aria-busy={loading}>
        {status === null ? (
          <p className="settings-helper">
            {loading ? "Checking Claude Code, Codex, and API keys..." : "Provider status unavailable."}
          </p>
        ) : (
          status.providers
            .filter((provider) => isSubscriptionProvider(provider.id))
            .map((provider) => {
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
                      {provider.id === status.activeProviderId ? (
                        <>
                          <Check aria-hidden="true" size={12} />
                          In use
                        </>
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
                        busy={action.busy}
                        onConnect={() => void providers.connect(subscription)}
                        onDisconnect={() => void providers.disconnect(subscription)}
                      />
                    ) : null}
                  </div>
                  {connectState !== undefined && isConnecting(connectState) ? (
                    <SubscriptionSignIn
                      label={provider.id === "claude-code" ? "Claude Code" : "Codex"}
                      state={connectState}
                      onCancel={() => providers.cancel(connectState)}
                    />
                  ) : null}
                </div>
              );
            })
        )}
        {action.error !== null ? <p className="subscription-error">{action.error}</p> : null}
      </div>
      <div className="settings-inline-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void providers.load(true)}
        >
          <RefreshCw aria-hidden="true" size={12} />
          <span>{loading ? "Checking" : "Check again"}</span>
        </button>
      </div>
    </>
  );
}
