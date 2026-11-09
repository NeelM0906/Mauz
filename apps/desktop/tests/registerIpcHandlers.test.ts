import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: ipcMainMock
}));
vi.mock("@mauzai/api/server", () => ({
  getAiProvidersStatus: vi.fn(async () => ({
    preference: "auto",
    activeProviderId: null,
    providers: []
  }))
}));

import { IPC_CHANNELS, type MauzDesktopContext } from "@mauzai/shared";
import type { ContextCollector } from "../src/main/context/ContextCollector";
import { registerIpcHandlers } from "../src/main/ipc/registerIpcHandlers";
import type { LocalApiHandle } from "../src/main/server/launchLocalApi";
import type { PopoverWindowController } from "../src/main/windows/PopoverWindowController";

const HANDLED_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuSetLensExpanded,
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

describe("registerIpcHandlers", () => {
  beforeEach(() => {
    ipcMainMock.handle.mockClear();
    ipcMainMock.removeHandler.mockClear();
    vi.unstubAllGlobals();
  });

  it("removes owned invoke handlers before registering them", () => {
    registerIpcHandlers(createOptions());

    expect(ipcMainMock.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(HANDLED_CHANNELS);
    expect(ipcMainMock.handle.mock.calls.map(([channel]) => channel)).toEqual(HANDLED_CHANNELS);
    expect(Math.max(...ipcMainMock.removeHandler.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...ipcMainMock.handle.mock.invocationCallOrder)
    );
  });

  it("can register twice without reusing stale handlers", () => {
    registerIpcHandlers(createOptions());
    registerIpcHandlers(createOptions());

    expect(ipcMainMock.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      ...HANDLED_CHANNELS,
      ...HANDLED_CHANNELS
    ]);
    expect(ipcMainMock.handle.mock.calls.map(([channel]) => channel)).toEqual([
      ...HANDLED_CHANNELS,
      ...HANDLED_CHANNELS
    ]);
  });

  it("opens Ask mode even when screenshot capture returned a permission fallback", async () => {
    const options = createOptions();
    const context: MauzDesktopContext = {
      timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
      platform: "darwin",
      cursor: {
        x: 200,
        y: 300
      },
      screenshotError: {
        permission: "screen-recording",
        message: "Mauz needs Screen Recording permission to capture screenshot context."
      }
    };

    vi.mocked(options.contextCollector.collectForAsk).mockResolvedValue(context);
    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartAsk);

    await expect(handler(createInvokeEvent())).resolves.toEqual(context);
    expect(options.popover.resizeForAsk).not.toHaveBeenCalled();
    expect(options.popover.resizeForMenu).not.toHaveBeenCalled();
  });

  it("resizes Lens only when the popover asks to expand or collapse", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuSetLensExpanded);

    await handler(createInvokeEvent(), {
      expanded: true
    });
    expect(options.popover.resizeForAsk).toHaveBeenCalledOnce();
    expect(options.popover.resizeForMenu).not.toHaveBeenCalled();

    await handler(createInvokeEvent(), {
      expanded: false
    });
    expect(options.popover.resizeForMenu).toHaveBeenCalledOnce();
  });

  it("clears activation context when the popover closes", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuClose);

    await handler(createInvokeEvent());

    expect(options.contextCollector.discardActivationSnapshot).toHaveBeenCalledOnce();
    expect(options.popover.hide).toHaveBeenCalledOnce();
  });

  it("can read settings from the popover without opening the settings panel", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await handler(createInvokeEvent(), {
      resizePopover: false
    });

    expect(options.popover.resizeForSettings).not.toHaveBeenCalled();
  });

  it("rejects privileged invoke calls without renderer metadata", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartAsk);

    await expect(handler()).rejects.toThrow("Mauz rejected an IPC request without renderer metadata.");
    expect(options.contextCollector.collectForAsk).not.toHaveBeenCalled();
  });

  it("accepts trusted loopback dev renderer origins", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await expect(
      handler(createInvokeEvent("http://[::1]:5173"), { resizePopover: false })
    ).resolves.toMatchObject({
      taskAgent: "auto"
    });
    expect(options.getSettings).toHaveBeenCalledOnce();
  });

  it("rejects renderer requests from non-local origins", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await expect(handler(createInvokeEvent("https://example.test"))).rejects.toThrow(
      "Mauz rejected an IPC request from an untrusted renderer."
    );
    expect(options.getSettings).not.toHaveBeenCalled();
  });

  it("passes Task agent settings through to updateSettings without stripping them", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsUpdate);

    await handler(createInvokeEvent(), {
      taskAgent: "hermes",
      taskFolder: "C:/work"
    });

    expect(options.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ taskAgent: "hermes", taskFolder: "C:/work" })
    );
  });

  it("returns AI provider status and forwards refresh requests", async () => {
    const getProvidersStatus = vi.fn(async () => ({
      preference: "auto" as const,
      activeProviderId: "claude-code" as const,
      providers: [
        {
          id: "claude-code" as const,
          label: "Claude Code subscription",
          kind: "subscription" as const,
          available: true,
          detail: "Signed in (max plan).",
          model: "sonnet"
        }
      ]
    }));

    registerIpcHandlers({ ...createOptions(), getProvidersStatus });

    const handler = getRegisteredHandler(IPC_CHANNELS.providersStatus);

    await expect(handler(createInvokeEvent(), { refresh: true })).resolves.toMatchObject({
      activeProviderId: "claude-code"
    });
    expect(getProvidersStatus).toHaveBeenCalledWith({ refresh: true });
  });

  it("starts subscription sign-in and opens only the link the CLI printed", async () => {
    const state = {
      connectId: "connect-1",
      providerId: "codex" as const,
      phase: "waiting" as const,
      url: "https://auth.openai.com/codex/device",
      userCode: "AB12-CD34E",
      acceptsPastedCode: false,
      message: null
    };
    const subscriptionConnector = {
      connect: vi.fn(() => state),
      submitCode: vi.fn(),
      cancel: vi.fn(),
      disconnect: vi.fn(async () => {}),
      getState: vi.fn(() => state)
    };
    const openExternal = vi.fn(async () => {});

    registerIpcHandlers({ ...createOptions(), subscriptionConnector, openExternal });

    await expect(
      getRegisteredHandler(IPC_CHANNELS.providersConnect)(createInvokeEvent(), {
        providerId: "codex"
      })
    ).resolves.toEqual(state);
    await getRegisteredHandler(IPC_CHANNELS.providersConnectOpenPage)(createInvokeEvent(), {
      connectId: "connect-1",
      url: "https://attacker.example"
    });

    expect(subscriptionConnector.connect).toHaveBeenCalledWith("codex");
    expect(openExternal).toHaveBeenCalledWith("https://auth.openai.com/codex/device");
  });

  it("lists installed agents and picks the configured one", async () => {
    const options = createOptions();
    vi.mocked(options.getSettings).mockResolvedValueOnce({
      ...(await options.getSettings()),
      taskAgent: "codex"
    });

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.taskAgents);

    await expect(handler(createInvokeEvent())).resolves.toEqual({
      agents: [
        { id: "hermes", label: "Hermes", installed: true },
        { id: "claude-code", label: "Claude Code", installed: false },
        { id: "codex", label: "Codex", installed: true }
      ],
      selectedAgentId: "codex"
    });
  });

  it("puts the last folder used with an agent first, then its own folders, then the default", async () => {
    const options = createOptions();
    vi.mocked(options.getSettings).mockResolvedValueOnce({
      ...(await options.getSettings()),
      taskFolder: "C:/work",
      taskAgentFolders: { "claude-code": "C:/work/last" }
    });

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.taskFolders);

    await expect(handler(createInvokeEvent(), { agentId: "claude-code" })).resolves.toEqual({
      folders: [
        { path: "C:/work/last", name: "last" },
        { path: "C:/work/mauz", name: "mauz" },
        { path: "C:/work", name: "work" }
      ],
      selectedPath: "C:/work/last"
    });
  });

  it("launches the agent and remembers the agent and folder for next time", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.taskSend);
    const request = { agentId: "hermes", folder: "C:/work/mauz", task: "Fix this", context: createContext() };

    await expect(handler(createInvokeEvent(), request)).resolves.toEqual({ agentLabel: "Hermes" });
    expect(options.taskAgents.launcher.launch).toHaveBeenCalledWith(request);
    expect(options.updateSettings).toHaveBeenCalledWith({
      taskAgent: "hermes",
      taskAgentFolders: { hermes: "C:/work/mauz" }
    });
  });
});

function createContext(): MauzDesktopContext {
  return {
    timestamp: "2026-11-04T12:00:00.000Z",
    platform: "win32",
    cursor: { x: 10, y: 20 }
  };
}

function getRegisteredHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  const call = ipcMainMock.handle.mock.calls.find(([registeredChannel]) => registeredChannel === channel);

  if (call === undefined) {
    throw new Error(`Missing registered handler for ${channel}.`);
  }

  return call[1] as (...args: unknown[]) => Promise<unknown>;
}

function createInvokeEvent(origin = "file:///renderer"): unknown {
  const url = `${origin}/index.html`;

  return {
    senderFrame: {
      url
    },
    sender: {
      getURL: () => url
    }
  };
}

function createAskContext(): MauzDesktopContext {
  return {
    timestamp: new Date("2026-05-14T12:00:00.000Z").toISOString(),
    platform: "darwin",
    cursor: {
      x: 200,
      y: 300
    },
    pointer: {
      cursor: {
        x: 200,
        y: 300
      },
      cursorCrop: {
        mimeType: "image/jpeg",
        base64: "cursor-crop",
        width: 320,
        height: 240
      }
    }
  };
}

function createOptions(): Parameters<typeof registerIpcHandlers>[0] {
  const popover = {
    hide: vi.fn(),
    resizeForAsk: vi.fn(),
    resizeForMenu: vi.fn(),
    resizeForSettings: vi.fn()
  } as unknown as PopoverWindowController;
  const contextCollector = {
    collectBasicContext: vi.fn(),
    collectForAsk: vi.fn(),
    discardActivationSnapshot: vi.fn()
  } as unknown as ContextCollector;
  const api: LocalApiHandle = {
    baseUrl: "http://127.0.0.1:47891",
    port: 47891,
    stop: vi.fn(async () => {})
  };

  return {
    popover,
    contextCollector,
    api,
    localApiToken: "test-token",
    taskAgents: {
      launcher: {
        listAgents: vi.fn(() => [
          { id: "hermes" as const, label: "Hermes", installed: true },
          { id: "claude-code" as const, label: "Claude Code", installed: false },
          { id: "codex" as const, label: "Codex", installed: true }
        ]),
        resolveAgent: vi.fn((preference: string, agents: Array<{ id: string; installed: boolean }>) => {
          const installed = agents.filter((agent) => agent.installed);
          return (installed.find((agent) => agent.id === preference) ?? installed[0])?.id ?? null;
        }) as never,
        listFolders: vi.fn(() => [{ path: "C:/work/mauz", name: "mauz" }]),
        toTaskFolder: vi.fn((path: string) => ({ path, name: path.split("/").pop() ?? path })),
        folderKey: vi.fn((path: string) => path.toLowerCase()),
        defaultFolder: vi.fn((configured: string) => configured || "C:/Users/test"),
        launch: vi.fn(async () => ({ agentLabel: "Hermes" }))
      },
      pickFolder: vi.fn(async () => null)
    },
    getSettings: vi.fn(async () => ({
      nativeShakeEnabled: false,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal" as const,
      openAiAuthDisconnected: false,
      openAiCredentialSource: "none" as const,
      askModel: "gpt-5.4-mini",
      captureBlockedApps: [],
      captureBlockedSites: [],
      apiKeyConfigured: false,
      taskAgent: "auto" as const,
      taskFolder: "",
      taskAgentFolders: {},
      aiProvider: "auto" as const,
      anthropicKeyConfigured: false
    })),
    updateSettings: vi.fn(async (update) => ({
      nativeShakeEnabled: update.nativeShakeEnabled ?? false,
      devHotkeyEnabled: update.devHotkeyEnabled ?? true,
      shakeSensitivity: update.shakeSensitivity ?? ("normal" as const),
      openAiAuthDisconnected: update.openAiAuthDisconnected ?? false,
      openAiCredentialSource: "none" as const,
      askModel: update.askModel ?? "gpt-5.4-mini",
      captureBlockedApps: update.captureBlockedApps ?? [],
      captureBlockedSites: update.captureBlockedSites ?? [],
      apiKeyConfigured: false,
      taskAgent: update.taskAgent ?? ("auto" as const),
      taskFolder: update.taskFolder ?? "",
      taskAgentFolders: update.taskAgentFolders ?? {},
      aiProvider: update.aiProvider ?? ("auto" as const),
      anthropicKeyConfigured: false
    }))
  };
}
