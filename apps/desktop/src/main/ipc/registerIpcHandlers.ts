import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  AiProvidersStatusRequestSchema,
  AiProvidersStatusResponseSchema,
  AskSessionRefSchema,
  AskSessionRequestSchema,
  AskSessionViewSchema,
  IPC_CHANNELS,
  MauzSettingsUpdateSchema,
  SubscriptionCancelRequestSchema,
  SubscriptionCodeRequestSchema,
  SubscriptionConnectRequestSchema,
  SubscriptionConnectStateSchema,
  SubscriptionDisconnectRequestSchema,
  DictateTranscribeRequestSchema,
  DictateTranscribeResponseSchema,
  TaskAgentsResponseSchema,
  TaskFoldersRequestSchema,
  TaskFoldersResponseSchema,
  TaskSendRequestSchema,
  type BrowserExtensionStatus,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";
import { getAiProvidersStatus, type SubscriptionConnector } from "@mauzai/api/server";
import type { AskSessions } from "../ask/AskSessions";
import type { TaskAgentLauncher } from "../agent/TaskAgentLauncher";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import type { DictateTranscriber } from "../dictate/DictateTranscriber";
import { isTrustedRendererUrl } from "../windows/WindowSecurity";

type RegisterIpcHandlersOptions = {
  /** The dev-server URL (`ELECTRON_RENDERER_URL`); without it only `file:` renderers are trusted. */
  rendererUrl?: string | undefined;
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
  askSessions: AskSessions;
  invalidateActivation?: () => void;
  getSettings: () => Promise<MauzSettings>;
  updateSettings: (update: MauzSettingsUpdate) => Promise<MauzSettings>;
  taskAgents: {
    launcher: Pick<
      TaskAgentLauncher,
      | "listAgents"
      | "resolveAgent"
      | "listFolders"
      | "toTaskFolder"
      | "folderKey"
      | "defaultFolder"
      | "launch"
    >;
    /** Opens a folder dialog over the popover; null when cancelled. */
    pickFolder(): Promise<string | null>;
  };
  getProvidersStatus?: typeof getAiProvidersStatus;
  dictateTranscriber?: Pick<DictateTranscriber, "transcribe">;
  subscriptionConnector?: Pick<
    SubscriptionConnector,
    "connect" | "submitCode" | "cancel" | "disconnect" | "getState"
  >;
  openExternal?: (url: string) => Promise<void>;
  browserExtension?: {
    status(): BrowserExtensionStatus;
    openExtensionFolder(): Promise<void>;
  };
};

/**
 * Returns a function that registers an invoke handler which first rejects untrusted senders. It
 * replaces a handler from an earlier call, so registering twice does not throw.
 */
function createHandle(rendererUrl: string | undefined) {
  return (channel: string, listener: (event: IpcMainInvokeEvent, payload: unknown) => unknown): void => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, async (event, payload: unknown) => {
      assertTrustedSender(event, rendererUrl);
      return listener(event, payload);
    });
  };
}

export function registerIpcHandlers({
  rendererUrl,
  popover,
  contextCollector,
  askSessions,
  invalidateActivation,
  getSettings,
  updateSettings,
  taskAgents,
  getProvidersStatus = getAiProvidersStatus,
  dictateTranscriber,
  subscriptionConnector,
  openExternal,
  browserExtension
}: RegisterIpcHandlersOptions): void {
  const handle = createHandle(rendererUrl);

  handle(IPC_CHANNELS.menuShowMenu, () => {
    invalidateActivation?.();
    askSessions.suspend();
    popover.resizeForMenu();
  });

  handle(IPC_CHANNELS.menuClose, () => {
    invalidateActivation?.();
    contextCollector.discardActivationSnapshot();
    askSessions.close();
    popover.hide();
  });

  handle(IPC_CHANNELS.menuStartAsk, async () => {
    return contextCollector.collectForAsk({ retainActivation: true });
  });
  handle(IPC_CHANNELS.menuExpand, () => {
    popover.resizeForAsk();
  });

  handle(IPC_CHANNELS.settingsOpen, async () => {
    invalidateActivation?.();
    askSessions.suspend();
    popover.resizeForSettings();
    return getSettings();
  });

  handle(IPC_CHANNELS.settingsUpdate, async (_event, payload) => {
    const parsedPayload = MauzSettingsUpdateSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new Error("Invalid Mauz settings update.");
    }

    return updateSettings(parsedPayload.data as MauzSettingsUpdate);
  });

  handle(IPC_CHANNELS.askOpen, async () => {
    const activation = contextCollector.currentAskActivation();
    const version = contextCollector.activationVersion;
    const capture = !askSessions.matches(activation)
      ? await contextCollector.collectForAsk({
          requireActivation: true,
          retainActivation: true,
          verifyBrowser: activation ?? undefined
        })
      : undefined;
    if (version !== contextCollector.activationVersion)
      throw new Error("The target changed. Invoke Mauz again.");
    const verified = capture?.captureBlocked !== undefined ? { blocked: true } : activation;
    const view = askSessions.open(verified, capture);
    popover.resizeForAsk();
    return AskSessionViewSchema.parse(view);
  });

  handle(IPC_CHANNELS.askNew, (_event, payload) => {
    const { sessionId } = AskSessionRefSchema.parse(payload);
    return AskSessionViewSchema.parse(askSessions.newChat(sessionId));
  });

  handle(IPC_CHANNELS.askStop, (_event, payload) => {
    const { sessionId } = AskSessionRefSchema.parse(payload);
    askSessions.stop(sessionId);
  });

  handle(IPC_CHANNELS.askSubmit, (event, payload) => {
    const request = AskSessionRequestSchema.parse(payload);
    return askSessions.submit(request, (text) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC_CHANNELS.askDelta, {
          sessionId: request.sessionId,
          requestId: request.requestId,
          text
        });
      }
    });
  });

  handle(IPC_CHANNELS.taskAgents, async () => {
    const settings = await getSettings();
    const agents = taskAgents.launcher.listAgents();

    return TaskAgentsResponseSchema.parse({
      agents,
      selectedAgentId: taskAgents.launcher.resolveAgent(settings.taskAgent, agents)
    });
  });

  handle(IPC_CHANNELS.taskFolders, async (_event, payload) => {
    const { agentId } = TaskFoldersRequestSchema.parse(payload);
    const settings = await getSettings();
    const launcher = taskAgents.launcher;
    const defaultFolder = launcher.defaultFolder(settings.taskFolder);
    const lastUsed = settings.taskAgentFolders[agentId];
    // The last folder used with this agent first, then the agent's own recent folders, then the default.
    const candidates = [
      ...(lastUsed === undefined ? [] : [launcher.toTaskFolder(lastUsed)]),
      ...launcher.listFolders(agentId),
      launcher.toTaskFolder(defaultFolder)
    ];
    const seen = new Set<string>();
    const folders = candidates.filter((folder) => {
      const key = launcher.folderKey(folder.path);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });

    return TaskFoldersResponseSchema.parse({
      folders: folders.slice(0, 100),
      selectedPath: lastUsed ?? defaultFolder
    });
  });

  handle(IPC_CHANNELS.taskPickFolder, async () => {
    return taskAgents.pickFolder();
  });

  handle(IPC_CHANNELS.taskSend, async (_event, payload) => {
    const request = TaskSendRequestSchema.parse(payload);
    await taskAgents.launcher.launch(request);
    const settings = await getSettings();

    // The agent picked here becomes the default, so the next task goes to it too.
    await updateSettings({
      taskAgent: request.agentId,
      taskAgentFolders: { ...settings.taskAgentFolders, [request.agentId]: request.folder }
    });
  });

  handle(IPC_CHANNELS.providersStatus, async (_event, payload) => {
    const request = AiProvidersStatusRequestSchema.parse(payload);
    const status = await getProvidersStatus({ refresh: request?.refresh === true });

    return AiProvidersStatusResponseSchema.parse(status);
  });

  handle(IPC_CHANNELS.providersConnect, async (_event, payload) => {
    const request = SubscriptionConnectRequestSchema.parse(payload);

    return SubscriptionConnectStateSchema.parse(requireConnector().connect(request.providerId));
  });

  handle(IPC_CHANNELS.providersConnectCode, async (_event, payload) => {
    const request = SubscriptionCodeRequestSchema.parse(payload);
    requireConnector().submitCode(request.connectId, request.code);
  });

  handle(IPC_CHANNELS.providersConnectCancel, async (_event, payload) => {
    requireConnector().cancel(SubscriptionCancelRequestSchema.parse(payload).connectId);
  });

  handle(IPC_CHANNELS.providersConnectOpenPage, async (_event, payload) => {
    const state = requireConnector().getState(SubscriptionCancelRequestSchema.parse(payload).connectId);

    // Only the sign-in page the CLI printed can be opened, never a URL from the renderer.
    if (state?.url?.startsWith("https://") === true && openExternal !== undefined) {
      await openExternal(state.url);
    }
  });

  handle(IPC_CHANNELS.providersDisconnect, async (_event, payload) => {
    const request = SubscriptionDisconnectRequestSchema.parse(payload);
    askSessions.close();
    await requireConnector().disconnect(request.providerId);

    return AiProvidersStatusResponseSchema.parse(await getProvidersStatus({ refresh: true }));
  });

  function requireConnector(): NonNullable<RegisterIpcHandlersOptions["subscriptionConnector"]> {
    if (subscriptionConnector === undefined) {
      throw new Error("Connecting subscriptions is not available.");
    }

    return subscriptionConnector;
  }

  handle(IPC_CHANNELS.dictateTranscribe, async (_event, payload) => {
    const request = DictateTranscribeRequestSchema.parse(payload);

    if (dictateTranscriber === undefined) {
      throw new Error("Dictation is not available in this build.");
    }

    return DictateTranscribeResponseSchema.parse(await dictateTranscriber.transcribe(request));
  });

  handle(IPC_CHANNELS.browserStatus, (): BrowserExtensionStatus => {
    return (
      browserExtension?.status() ?? { connectedBrowsers: [], extensionPath: null, hostRegistered: false }
    );
  });

  handle(IPC_CHANNELS.browserOpenExtensionFolder, async () => {
    await browserExtension?.openExtensionFolder();
  });
}

function assertTrustedSender(event: IpcMainInvokeEvent | undefined, rendererUrl: string | undefined): void {
  if (event === undefined) {
    throw new Error("Mauz rejected an IPC request without renderer metadata.");
  }

  // Same rule as navigation: a file: page, or the dev server's exact origin.
  if (!isTrustedRendererUrl(event.senderFrame?.url ?? event.sender.getURL(), rendererUrl)) {
    throw new Error("Mauz rejected an IPC request from an untrusted renderer.");
  }
}
