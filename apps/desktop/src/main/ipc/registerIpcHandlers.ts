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
  TaskSendResponseSchema,
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

const HANDLED_IPC_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuExpand,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.taskAgents,
  IPC_CHANNELS.taskFolders,
  IPC_CHANNELS.taskPickFolder,
  IPC_CHANNELS.taskSend,
  IPC_CHANNELS.providersStatus,
  IPC_CHANNELS.providersConnect,
  IPC_CHANNELS.providersConnectCode,
  IPC_CHANNELS.providersConnectCancel,
  IPC_CHANNELS.providersConnectOpenPage,
  IPC_CHANNELS.providersDisconnect,
  IPC_CHANNELS.talkTranscribe,
  IPC_CHANNELS.browserStatus,
  IPC_CHANNELS.browserOpenExtensionFolder
] as const;

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
  for (const channel of HANDLED_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_CHANNELS.menuShowMenu, (event) => {
    assertTrustedSender(event);
    popover.resizeForMenu();
  });

  ipcMain.handle(IPC_CHANNELS.menuClose, (event) => {
    assertTrustedSender(event);
    contextCollector.discardActivationSnapshot();
    popover.hide();
  });

  ipcMain.handle(IPC_CHANNELS.menuStartAsk, async (event) => {
    assertTrustedSender(event);
    return contextCollector.collectForAsk();
  });
  ipcMain.handle(IPC_CHANNELS.menuExpand, (event) => {
    assertTrustedSender(event);
    popover.resizeForAsk();
  });

  ipcMain.handle(IPC_CHANNELS.settingsOpen, async (event) => {
    assertTrustedSender(event);
    popover.resizeForSettings();
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const parsedPayload = MauzSettingsUpdateSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new Error("Invalid Mauz settings update.");
    }

    return updateSettings(parsedPayload.data as MauzSettingsUpdate);
  });

  ipcMain.handle(IPC_CHANNELS.askSubmit, async (event, payload: unknown) => {
    assertTrustedSender(event);
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

  ipcMain.handle(IPC_CHANNELS.taskAgents, async (event) => {
    assertTrustedSender(event);
    const settings = await getSettings();
    const agents = taskAgents.launcher.listAgents();

    return TaskAgentsResponseSchema.parse({
      agents,
      selectedAgentId: taskAgents.launcher.resolveAgent(settings.taskAgent, agents)
    });
  });

  ipcMain.handle(IPC_CHANNELS.taskFolders, async (event, payload: unknown) => {
    assertTrustedSender(event);
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

  ipcMain.handle(IPC_CHANNELS.taskPickFolder, async (event) => {
    assertTrustedSender(event);
    return taskAgents.pickFolder();
  });

  ipcMain.handle(IPC_CHANNELS.taskSend, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = TaskSendRequestSchema.parse(payload);
    const result = await taskAgents.launcher.launch(request);
    const settings = await getSettings();

    // The agent picked here becomes the default, so the next task goes to it too.
    await updateSettings({
      taskAgent: request.agentId,
      taskAgentFolders: { ...settings.taskAgentFolders, [request.agentId]: request.folder }
    });

    return TaskSendResponseSchema.parse(result);
  });

  ipcMain.handle(IPC_CHANNELS.providersStatus, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = AiProvidersStatusRequestSchema.parse(payload);
    const status = await getProvidersStatus({ refresh: request?.refresh === true });

    return AiProvidersStatusResponseSchema.parse(status);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnect, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = SubscriptionConnectRequestSchema.parse(payload);

    return SubscriptionConnectStateSchema.parse(requireConnector().connect(request.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectCode, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = SubscriptionCodeRequestSchema.parse(payload);
    requireConnector().submitCode(request.connectId, request.code);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectCancel, async (event, payload: unknown) => {
    assertTrustedSender(event);
    requireConnector().cancel(SubscriptionCancelRequestSchema.parse(payload).connectId);
  });

  ipcMain.handle(IPC_CHANNELS.providersConnectOpenPage, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const state = requireConnector().getState(SubscriptionCancelRequestSchema.parse(payload).connectId);

    // Only the sign-in page the CLI printed can be opened, never a URL from the renderer.
    if (state?.url?.startsWith("https://") === true && openExternal !== undefined) {
      await openExternal(state.url);
    }
  });

  ipcMain.handle(IPC_CHANNELS.providersDisconnect, async (event, payload: unknown) => {
    assertTrustedSender(event);
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

  ipcMain.handle(IPC_CHANNELS.talkTranscribe, async (event, payload: unknown) => {
    assertTrustedSender(event);
    const request = TalkTranscribeRequestSchema.parse(payload);

    if (talkTranscriber === undefined) {
      throw new Error("Dictation is not available in this build.");
    }

    return TalkTranscribeResponseSchema.parse(await talkTranscriber.transcribe(request));
  });

  ipcMain.handle(IPC_CHANNELS.browserStatus, (event): BrowserExtensionStatus => {
    assertTrustedSender(event);

    return (
      browserExtension?.status() ?? { connectedBrowsers: [], extensionPath: null, hostRegistered: false }
    );
  });

  ipcMain.handle(IPC_CHANNELS.browserOpenExtensionFolder, async (event) => {
    assertTrustedSender(event);
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
