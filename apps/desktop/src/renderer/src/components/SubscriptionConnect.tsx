import { ExternalLink, LogIn, LogOut, X } from "lucide-react";
import { useState } from "react";
import type { AiProviderStatus, SubscriptionConnectState, SubscriptionProviderId } from "@mauzai/shared";
import { mauzClient } from "@renderer/lib/mauzClient";

export function isSubscriptionProvider(id: AiProviderStatus["id"]): id is SubscriptionProviderId {
  return id === "claude-code" || id === "codex";
}

export function isConnecting(state: SubscriptionConnectState | undefined): boolean {
  return state?.phase === "installing" || state?.phase === "starting" || state?.phase === "waiting";
}

type SubscriptionButtonProps = {
  provider: AiProviderStatus & { id: SubscriptionProviderId };
  state: SubscriptionConnectState | undefined;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
};

/** Connect or Sign out, next to a subscription's status. */
export function SubscriptionButton({
  provider,
  state,
  busy,
  onConnect,
  onDisconnect
}: SubscriptionButtonProps): React.JSX.Element | null {
  if (isConnecting(state)) {
    return null;
  }

  if (provider.available) {
    return (
      <button type="button" className="provider-action-button" disabled={busy} onClick={onDisconnect}>
        <LogOut aria-hidden="true" size={11} />
        <span>Sign out</span>
      </button>
    );
  }

  const notInstalled = /not installed/i.test(provider.detail);

  return (
    <button
      type="button"
      className="provider-action-button"
      data-primary="true"
      disabled={busy}
      onClick={onConnect}
    >
      <LogIn aria-hidden="true" size={11} />
      <span>{notInstalled ? "Install & connect" : "Connect"}</span>
    </button>
  );
}

type SubscriptionSignInProps = {
  label: string;
  state: SubscriptionConnectState;
  onCancel: () => void;
};

/** Progress while Mauz installs a CLI or waits for the browser sign-in to finish. */
export function SubscriptionSignIn({ label, state, onCancel }: SubscriptionSignInProps): React.JSX.Element {
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);

  const submitCode = async (): Promise<void> => {
    setCodeError(null);

    try {
      await mauzClient.submitSubscriptionCode(state.connectId, code);
      setCodeSent(true);
      setCode("");
    } catch (error) {
      setCodeError(error instanceof Error ? error.message : "Could not send the code.");
    }
  };

  return (
    <div className="subscription-signin" role="status" aria-live="polite">
      {state.phase === "waiting" ? (
        <>
          <p>
            {state.userCode !== null
              ? `Sign in to ${label} in your browser and enter this code:`
              : `Finish signing in to ${label} in your browser.`}
          </p>
          {state.userCode !== null ? <code className="subscription-code">{state.userCode}</code> : null}
          {state.acceptsPastedCode ? (
            <form
              className="subscription-code-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCode();
              }}
            >
              <input
                type="text"
                value={code}
                placeholder={codeSent ? "Code sent. Waiting..." : "If the page shows a code, paste it here"}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setCode(event.target.value)}
              />
              <button type="submit" className="provider-action-button" disabled={code.trim().length === 0}>
                Submit
              </button>
            </form>
          ) : null}
          {codeError !== null ? <p className="subscription-error">{codeError}</p> : null}
        </>
      ) : (
        <p>{state.message ?? `Starting ${label} sign-in...`}</p>
      )}
      <div className="subscription-signin-actions">
        {state.phase === "waiting" && state.url !== null ? (
          <button
            type="button"
            className="provider-action-button"
            onClick={() => void mauzClient.openSubscriptionConnectPage(state.connectId)}
          >
            <ExternalLink aria-hidden="true" size={11} />
            <span>Open sign-in page</span>
          </button>
        ) : null}
        <button type="button" className="provider-action-button" onClick={onCancel}>
          <X aria-hidden="true" size={11} />
          <span>Cancel</span>
        </button>
      </div>
    </div>
  );
}
