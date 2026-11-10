import {
  Bot,
  Check,
  FolderOpen,
  Globe,
  MousePointerClick,
  Settings2,
  ShieldOff,
  Trash2,
  Zap
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  BrowserExtensionStatus,
  MauzSettings,
  ShakeSensitivity,
  TaskAgentPreference,
  TaskAgentStatus
} from "@mauzai/shared";
import { mauz } from "@renderer/lib/mauzClient";
import type { ApiKeyDraft, BlockedListText } from "@renderer/lib/settingsUpdate";

export type UpdateDraft = <Key extends keyof MauzSettings>(key: Key, value: MauzSettings[Key]) => void;

type DraftProps = { draft: MauzSettings; updateDraft: UpdateDraft };

const SENSITIVITY_OPTIONS: Array<{ value: ShakeSensitivity; label: string }> = [
  { value: "relaxed", label: "Relaxed" },
  { value: "normal", label: "Normal" },
  { value: "strict", label: "Strict" }
];

const FALLBACK_TASK_AGENTS: TaskAgentStatus[] = [
  { id: "hermes", label: "Hermes", installed: true },
  { id: "claude-code", label: "Claude Code", installed: true },
  { id: "codex", label: "Codex", installed: true }
];

/** A password field for one API key, with "Clear saved key" when a key is saved. */
export function ApiKeyField({
  label,
  placeholder,
  configured,
  draft,
  saving,
  onChange,
  onClear
}: {
  label: string;
  placeholder: string;
  configured: boolean;
  draft: ApiKeyDraft;
  saving: boolean;
  onChange(value: string): void;
  onClear(): void;
}): React.JSX.Element {
  return (
    <>
      <label className="settings-field api-key-field">
        <span>{label}</span>
        <input
          type="password"
          value={draft.value}
          placeholder={configured ? "Configured - enter a new key to replace" : placeholder}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {configured ? (
        <div className="settings-inline-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={saving || draft.clear}
            onClick={onClear}
          >
            <Trash2 aria-hidden="true" size={12} />
            <span>{draft.clear ? "Marked clear" : "Clear saved key"}</span>
          </button>
        </div>
      ) : null}
    </>
  );
}

/**
 * Loads a value once when the caller mounts. It stays null until the load succeeds; a failed load
 * leaves it null (the sections then show their fallback).
 */
export function useLoadOnMount<T>(load: () => Promise<T>): T | null {
  const [value, setValue] = useState<T | null>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    let disposed = false;

    void loadRef.current().then(
      (loaded) => {
        if (!disposed) {
          setValue(loaded);
        }
      },
      () => {}
    );

    return () => {
      disposed = true;
    };
  }, []);

  return value;
}

/** `taskAgents` is null until loaded; the picker then lists every agent without install status. */
export function TaskAgentSection({
  draft,
  updateDraft,
  taskAgents
}: DraftProps & { taskAgents: TaskAgentStatus[] | null }): React.JSX.Element {
  const browseTaskFolder = async (): Promise<void> => {
    const picked = await mauz().task.pickFolder();

    if (picked !== null) {
      updateDraft("taskFolder", picked);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-label">
        <Bot aria-hidden="true" size={15} />
        <span>Task agent</span>
      </div>
      <label className="settings-field">
        <span>Send to agent uses</span>
        <select
          value={draft.taskAgent}
          onChange={(event) => updateDraft("taskAgent", event.target.value as TaskAgentPreference)}
        >
          <option value="auto">Automatic (first one installed)</option>
          {(taskAgents ?? FALLBACK_TASK_AGENTS).map((agent) => (
            <option key={agent.id} value={agent.id}>
              {taskAgents !== null && !agent.installed ? `${agent.label} (not installed)` : agent.label}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Default work folder</span>
        <div className="task-folder-row">
          <input
            type="text"
            value={draft.taskFolder}
            placeholder="Your home folder"
            spellCheck={false}
            onChange={(event) => updateDraft("taskFolder", event.target.value)}
          />
          <button type="button" className="secondary-button" onClick={() => void browseTaskFolder()}>
            <FolderOpen aria-hidden="true" size={13} />
            <span>Browse</span>
          </button>
        </div>
      </label>
      <p className="settings-helper">
        Send to agent opens the agent in its own window with your task and what you were pointing at. Pick a
        folder each time; this one is used when the agent has no recent folders.
      </p>
    </div>
  );
}

export function ActivationSection({ draft, updateDraft }: DraftProps): React.JSX.Element {
  return (
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
  );
}

export function NeverCaptureSection({
  blocked,
  onChange
}: {
  blocked: BlockedListText;
  onChange(blocked: BlockedListText): void;
}): React.JSX.Element {
  return (
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
        value={blocked.apps}
        onChange={(event) => onChange({ ...blocked, apps: event.target.value })}
      />
      <p className="settings-helper">
        One app per line: the program name on Windows (1Password.exe) or the bundle id on macOS. Mauz sends no
        screenshot, text, or window title from these apps. Up to 50 entries.
      </p>
      <textarea
        className="settings-textarea"
        aria-label="Sites Mauz never captures"
        rows={4}
        spellCheck={false}
        value={blocked.sites}
        onChange={(event) => onChange({ ...blocked, sites: event.target.value })}
      />
      <p className="settings-helper">
        One site per line. example.com also covers its subdomains; * matches anything (*bank*). Needs the
        browser extension: pages from these sites are not read or screenshotted. Up to 50 entries.
      </p>
    </div>
  );
}

/** `browserStatus` is null until loaded; the section then shows setup steps without a connection state. */
export function BrowserExtensionSection({
  browserStatus
}: {
  browserStatus: BrowserExtensionStatus | null;
}): React.JSX.Element {
  return (
    <div className="settings-section">
      <div className="settings-label">
        <Globe aria-hidden="true" size={15} />
        <span>Browser extension</span>
      </div>
      <p className="settings-helper" role="status">
        {getBrowserExtensionMessage(browserStatus)}
      </p>
      <p className="settings-helper">
        Lets Mauz read the page under the pointer in Chrome or Edge: its address, text, and product details
        such as price and sizes. To install, open chrome://extensions or edge://extensions, turn on Developer
        mode, choose Load unpacked, and pick the extension folder.
      </p>
      {browserStatus?.extensionPath ? (
        <div className="settings-inline-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void mauz().browser.openExtensionFolder()}
          >
            <FolderOpen aria-hidden="true" size={13} />
            <span>Extension folder</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getBrowserExtensionMessage(status: BrowserExtensionStatus | null): string {
  if (status === null) {
    return "Checking the browser extension...";
  }

  if (status.connectedBrowsers.length > 0) {
    return `Connected: ${status.connectedBrowsers.join(", ")}.`;
  }

  return status.hostRegistered
    ? "Not connected. Install the extension, or open the browser if it is installed."
    : "Not available: Mauz could not register its browser helper.";
}

function ToggleButton({ pressed, onClick }: { pressed: boolean; onClick(): void }): React.JSX.Element {
  return (
    <button className="toggle-button" type="button" aria-pressed={pressed} onClick={onClick}>
      {pressed ? <Check aria-hidden="true" size={14} /> : null}
    </button>
  );
}
