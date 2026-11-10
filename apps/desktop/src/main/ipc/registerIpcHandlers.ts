import { ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  AiProvidersStatusRequestSchema,
  AiProvidersStatusResponseSchema,
  AskMauzRequestSchema,
  IPC_CHANNELS,
  MauzSettingsUpdateSchema,
  SubscriptionCancelRequestSchema,
  SubscriptionCodeRequestSchema,
  SubscriptionConnectRequestSchema,
  SubscriptionConnectStateSchema,
  SubscriptionDisconnectRequestSchema,
  TalkTranscribeRequestSchema,
  TalkTranscribeResponseSchema,
  TaskAgentsResponseSchema,
  TaskFoldersRequestSchema,
  TaskFoldersResponseSchema,
  TaskSendRequestSchema,
  type BrowserExtensionStatus,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";
import { answerAsk, getAiProvidersStatus, type SubscriptionConnector } from "@mauzai/api/server";
import type { TaskAgentLauncher } from "../agent/TaskAgentLauncher";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import type { TalkTranscriber } from "../talk/TalkTranscriber";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
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
  talkTranscriber?: Pick<TalkTranscriber, "transcribe">;
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
 * Registers an invoke handler that first rejects untrusted senders. It replaces a handler from an
 * earlier call, so registering twice does not throw.
 */
function handle(channel: string, listener: (event: IpcMainInvokeEvent, payload: unknown) => unknown): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, payload: unknown) => {
    assertTrustedSender(event);
    return listener(event, payload);
  });
}

export function registerIpcHandlers({
  popover,
  contextCollector,
  getSettings,
  updateSettings,
  taskAgents,
  getProvidersStatus = getAiProvidersStatus,
  talkTranscriber,
  subscriptionConnector,
  openExternal,
  browserExtension
}: RegisterIpcHandlersOptions): void {
  handle(IPC_CHANNELS.menuShowMenu, () => {
    popover.resizeForMenu();
  });

  handle(IPC_CHANNELS.menuClose, () => {
    contextCollector.discardActivationSnapshot();
    popover.hide();
  });

  handle(IPC_CHANNELS.menuStartAsk, async () => {
    return contextCollector.collectForAsk();
  });
  handle(IPC_CHANNELS.menuExpand, () => {
    popover.resizeForAsk();
  });

  handle(IPC_CHANNELS.settingsOpen, async () => {
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

  handle(IPC_CHANNELS.askSubmit, async (event, payload) => {
    const request = AskMauzRequestSchema.parse(payload);
    const { requestId } = request;

    return answerAsk(
      request,
      requestId === undefined
        ? undefined
        : (text) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send(IPC_CHANNELS.askDelta, { requestId, text });
            }
          }
    );
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
    await requireConnector().disconnect(request.providerId);

    return AiProvidersStatusResponseSchema.parse(await getProvidersStatus({ refresh: true }));
  });

  function requireConnector(): NonNullable<RegisterIpcHandlersOptions["subscriptionConnector"]> {
    if (subscriptionConnector === undefined) {
      throw new Error("Connecting subscriptions is not available.");
    }

    return subscriptionConnector;
  }

  handle(IPC_CHANNELS.talkTranscribe, async (_event, payload) => {
    const request = TalkTranscribeRequestSchema.parse(payload);

    if (talkTranscriber === undefined) {
      throw new Error("Dictation is not available in this build.");
    }

    return TalkTranscribeResponseSchema.parse(await talkTranscriber.transcribe(request));
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

function assertTrustedSender(event: IpcMainInvokeEvent | undefined): void {
  if (event === undefined) {
    throw new Error("Mauz rejected an IPC request without renderer metadata.");
  }

  const frameUrl = event.senderFrame?.url ?? event.sender.getURL();

  try {
    if (isTrustedRendererOrigin(new URL(frameUrl))) {
      return;
    }
  } catch {
    // Fall through to the generic rejection below.
  }

  throw new Error("Mauz rejected an IPC request from an untrusted renderer.");
}

function isTrustedRendererOrigin(url: URL): boolean {
  if (url.protocol === "file:") {
    return true;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return false;
  }

  return (
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]"
  );
}
