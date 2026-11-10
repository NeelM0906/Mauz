import { ArrowLeft, BriefcaseBusiness, FolderOpen, LoaderCircle, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TaskAgentId, TaskAgentStatus, TaskFolder } from "@mauzai/shared";
import { detectLensObject } from "@renderer/lib/lensObject";
import { mauz } from "@renderer/lib/mauzClient";
import { findFolderForEditorWindow } from "@renderer/lib/taskFolders";
import { useMauzStore } from "@renderer/state/useMauzStore";
import { BrandLogo } from "./BrandLogo";
import { CaptureDetails } from "./CaptureDetails";

/**
 * Send to agent: the task and what was on screen go to the user's coding agent, which opens
 * in its own window in the chosen folder. Mauz closes once the agent has started.
 */
export function TaskPanel(): React.JSX.Element {
  const { currentContext, backToMenu, dictation, setDictation } = useMauzStore();
  const lensObject = useMemo(() => detectLensObject(currentContext), [currentContext]);
  const [task, setTask] = useState("");
  const [agents, setAgents] = useState<TaskAgentStatus[] | null>(null);
  const [agentId, setAgentId] = useState<TaskAgentId | null>(null);
  const [folders, setFolders] = useState<TaskFolder[]>([]);
  const [folder, setFolder] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (dictation !== null) {
      setTask(dictation);
      setDictation(null);
    }
  }, [dictation, setDictation]);

  useEffect(() => {
    let disposed = false;

    void mauz()
      .task.agents()
      .then(
        (response) => {
          if (!disposed) {
            setAgents(response.agents);
            setAgentId(response.selectedAgentId);
          }
        },
        (caught: unknown) => {
          if (!disposed) {
            setAgents([]);
            setError(caught instanceof Error ? caught.message : "Mauz could not look for agents.");
          }
        }
      );

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (agentId === null) {
      return;
    }

    let disposed = false;

    void mauz()
      .task.folders({ agentId })
      .then(
        (response) => {
          if (disposed) {
            return;
          }

          // Pointing at an editor picks the project open in it; otherwise the last folder used.
          const onScreen = findFolderForEditorWindow(response.folders, currentContext);
          setFolders(response.folders);
          setFolder(onScreen?.path ?? response.selectedPath);
        },
        () => {
          if (!disposed) {
            setFolders([]);
          }
        }
      );

    return () => {
      disposed = true;
    };
  }, [agentId, currentContext]);

  const handleBack = async (): Promise<void> => {
    await mauz().menu.showMenu();
    backToMenu();
  };

  const handleBrowse = async (): Promise<void> => {
    const picked = await mauz().task.pickFolder();

    if (picked !== null) {
      setFolders((current) =>
        current.some((entry) => entry.path === picked)
          ? current
          : [{ path: picked, name: baseName(picked) }, ...current]
      );
      setFolder(picked);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (currentContext === null || agentId === null || folder.length === 0 || task.trim().length === 0) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      await mauz().task.send({ agentId, folder, task: task.trim(), context: currentContext });
      setTask("");
      await mauz().menu.close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Mauz could not start the agent.");
    } finally {
      setSending(false);
    }
  };

  const installedAgents = agents?.filter((agent) => agent.installed) ?? [];
  const folderOptions =
    folders.some((entry) => entry.path === folder) || folder.length === 0
      ? folders
      : [{ path: folder, name: baseName(folder) }, ...folders];
  const canSend =
    !sending && currentContext !== null && agentId !== null && folder.length > 0 && task.trim().length > 0;

  return (
    <section className="lens-panel lens-task-panel task-panel" aria-label="Send to agent">
      <header className="lens-header lens-task-header">
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
            <h1 tabIndex={-1}>Send to agent</h1>
            <p>{lensObject.label}</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Close Mauz"
          onClick={() => void mauz().menu.close()}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </header>

      <CaptureDetails context={currentContext} />

      <form className="lens-task-form task-send-form" onSubmit={(event) => void handleSubmit(event)}>
        <textarea
          aria-label="Task for the agent"
          value={task}
          onChange={(event) => setTask(event.target.value)}
          placeholder="What should the agent do with this?"
          disabled={sending}
        />

        {agents !== null && installedAgents.length === 0 ? (
          <p className="ask-error">
            No coding agent found. Install Hermes, Claude Code, or Codex, then open Mauz again.
          </p>
        ) : (
          <div className="task-targets">
            <label className="settings-field">
              <span>Agent</span>
              <select
                value={agentId ?? ""}
                disabled={agents === null || sending}
                onChange={(event) => setAgentId(event.target.value as TaskAgentId)}
              >
                {agents === null ? <option value="">Looking for agents...</option> : null}
                {installedAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span>Folder</span>
              <div className="task-folder-row">
                <select
                  value={folder}
                  title={folder}
                  disabled={agentId === null || sending}
                  onChange={(event) => setFolder(event.target.value)}
                >
                  {folderOptions.map((entry) => (
                    <option key={entry.path} value={entry.path} title={entry.path}>
                      {entry.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="secondary-button"
                  aria-label="Browse for a folder"
                  disabled={sending}
                  onClick={() => void handleBrowse()}
                >
                  <FolderOpen aria-hidden="true" size={13} />
                  <span>Browse</span>
                </button>
              </div>
            </label>
            <p className="settings-helper task-folder-path">{folder}</p>
          </div>
        )}

        <button className="submit-button" type="submit" disabled={!canSend}>
          {sending ? (
            <LoaderCircle aria-hidden="true" className="spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
          <span>{sending ? "Opening agent" : "Send"}</span>
        </button>
      </form>

      {error !== null ? <p className="ask-error">{error}</p> : null}

      <p className="ask-empty task-send-note">
        <BriefcaseBusiness aria-hidden="true" size={13} />
        The agent opens in its own window with your task and a screenshot of what you were pointing at.
      </p>
    </section>
  );
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
