import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMainMock = vi.hoisted(() => ({
  handle: vi.fn(),
  removeHandler: vi.fn()
}));

vi.mock("electron", () => ({
  ipcMain: ipcMainMock,
  screen: { getCursorScreenPoint: () => ({ x: 700, y: 500 }) }
}));
vi.mock("@mauzai/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@mauzai/api/server")>()),
  getAiProvidersStatus: vi.fn(async () => ({
    preference: "auto",
    activeProviderId: null,
    providers: []
  }))
}));

import { AskSessions } from "../src/main/ask/AskSessions";
import { AskSessionViewSchema, IPC_CHANNELS, type MauzDesktopContext } from "@mauzai/shared";
import { ContextCollector } from "../src/main/context/ContextCollector";
import { ActiveWindowService } from "../src/main/context/ActiveWindowService";
import { ScreenshotService } from "../src/main/context/ScreenshotService";
import { SelectedTextService } from "../src/main/context/SelectedTextService";
import { registerIpcHandlers } from "../src/main/ipc/registerIpcHandlers";
import type { PopoverWindowController } from "../src/main/windows/PopoverWindowController";
import { isTrustedRendererUrl } from "../src/main/windows/WindowSecurity";

const HANDLED_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuExpand,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askOpen,
  IPC_CHANNELS.askNew,
  IPC_CHANNELS.askStop,
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
  IPC_CHANNELS.dictateTranscribe,
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
    HANDLED_CHANNELS.forEach((_channel, index) => {
      expect(ipcMainMock.removeHandler.mock.invocationCallOrder[index]).toBeLessThan(
        ipcMainMock.handle.mock.invocationCallOrder[index]!
      );
    });
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

  it("grows the popover to the panel size when the menu opens a panel", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuExpand);

    await handler(createInvokeEvent());
    expect(options.popover.resizeForAsk).toHaveBeenCalledOnce();
    expect(options.popover.resizeForMenu).not.toHaveBeenCalled();
  });

  it("clears activation context when the popover closes", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuClose);

    await handler(createInvokeEvent());

    expect(options.contextCollector.discardActivationSnapshot).toHaveBeenCalledOnce();
    expect(options.popover.hide).toHaveBeenCalledOnce();
  });

  it("sizes the popover for Settings when the renderer opens settings", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await handler(createInvokeEvent());

    expect(options.popover.resizeForSettings).toHaveBeenCalledOnce();
  });

  it("rejects privileged invoke calls without renderer metadata", async () => {
    const options = createOptions();

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.menuStartAsk);

    await expect(handler()).rejects.toThrow("Mauz rejected an IPC request without renderer metadata.");
    expect(options.contextCollector.collectForAsk).not.toHaveBeenCalled();
  });

  it("accepts the dev-server origin", async () => {
    const options = { ...createOptions(), rendererUrl: "http://[::1]:5173/" };

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await expect(handler(createInvokeEvent("http://[::1]:5173"))).resolves.toMatchObject({
      taskAgent: "auto"
    });
    expect(options.getSettings).toHaveBeenCalledOnce();
  });

  it("still accepts a file: page when a dev server is set, as navigation does", async () => {
    const options = { ...createOptions(), rendererUrl: "http://localhost:5173/" };

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await expect(handler(createInvokeEvent("file:///renderer"))).resolves.toMatchObject({
      taskAgent: "auto"
    });
    expect(isTrustedRendererUrl("file:///renderer/index.html", options.rendererUrl)).toBe(true);
  });

  it.each([
    ["another loopback port", "http://localhost:5173/", "http://localhost:9999"],
    ["another loopback host", "http://localhost:5173/", "http://127.0.0.1:5173"],
    ["another protocol", "http://localhost:5173/", "https://localhost:5173"],
    ["loopback without a dev server", undefined, "http://localhost:5173"]
  ])("rejects %s, as navigation does", async (_name, rendererUrl, origin) => {
    const options = { ...createOptions(), rendererUrl };

    registerIpcHandlers(options);

    const handler = getRegisteredHandler(IPC_CHANNELS.settingsOpen);

    await expect(handler(createInvokeEvent(origin))).rejects.toThrow(
      "Mauz rejected an IPC request from an untrusted renderer."
    );
    expect(isTrustedRendererUrl(`${origin}/index.html`, rendererUrl)).toBe(false);
    expect(options.getSettings).not.toHaveBeenCalled();
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

  it("routes an Ask turn through its session and keys updates by session and request", async () => {
    const options = createOptions();
    vi.mocked(options.askSessions.submit).mockImplementation(async (_request, onText) => {
      onText("partial");
    });
    registerIpcHandlers(options);
    const event = createInvokeEvent();
    const request = { sessionId: TEST_SESSION, question: "What is this?", requestId: "req-1" };

    await expect(getRegisteredHandler(IPC_CHANNELS.askSubmit)(event, request)).resolves.toBeUndefined();
    expect(options.askSessions.submit).toHaveBeenCalledWith(request, expect.any(Function));
    expect(event.sender.send).toHaveBeenCalledWith(IPC_CHANNELS.askDelta, {
      sessionId: TEST_SESSION,
      requestId: "req-1",
      text: "partial"
    });
  });

  it("sends the activation crop on the first Ask turn even when no app text is available", async () => {
    const context = createAskContext();
    const screenshotService = new ScreenshotService();
    const capture = vi.spyOn(screenshotService, "capturePointerContext").mockResolvedValue(context.pointer!);
    const collector = new ContextCollector({
      screenshotService,
      activeWindowService: new ActiveWindowService({ platform: "linux" }),
      selectedTextService: new SelectedTextService({ platform: "linux" })
    });
    const answer = vi.fn(async () => ({ text: "A browser page." }));
    const sessions = new AskSessions({
      onChange: vi.fn(),
      resolveProvider: async () => ({ id: "openai", answer })
    });
    registerIpcHandlers({ ...createOptions(), contextCollector: collector, askSessions: sessions });
    const event = createInvokeEvent();
    const open = getRegisteredHandler(IPC_CHANNELS.askOpen);
    const submit = getRegisteredHandler(IPC_CHANNELS.askSubmit);

    const missing = AskSessionViewSchema.parse(await open(event));
    expect(missing.source).toBeNull();
    expect(missing.notice).toContain("Point at what you want to ask about");
    expect(capture).not.toHaveBeenCalled();

    await collector.prepareForActivation(context.cursor);
    const chat = AskSessionViewSchema.parse(await open(event));
    expect(capture).toHaveBeenCalledWith(context.cursor, {});
    expect(chat.source).toMatchObject({ label: "Screenshot", hasImage: true, useImage: true });
    await submit(event, {
      sessionId: chat.id,
      requestId: "first",
      question: "What am I looking at?",
      sourceId: chat.source!.id
    });

    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: expect.stringContaining("<image>attached: crop centered on the pointer"),
        images: [
          expect.objectContaining({ base64: context.pointer!.cursorCrop!.base64, mimeType: "image/jpeg" })
        ]
      }),
      expect.anything()
    );
    expect(sessions.current()?.turns[0]).toMatchObject({
      answer: "A browser page.",
      sourceLabel: "Screenshot",
      imageId: expect.any(String)
    });
  });

  it("does not send Ask text updates to a destroyed window", async () => {
    const options = createOptions();
    vi.mocked(options.askSessions.submit).mockImplementation(async (_request, onText) => {
      onText("partial");
    });
    registerIpcHandlers(options);
    const event = createInvokeEvent();
    event.sender.isDestroyed.mockReturnValue(true);
    await getRegisteredHandler(IPC_CHANNELS.askSubmit)(event, {
      sessionId: TEST_SESSION,
      question: "What is this?",
      requestId: "req-1"
    });
    expect(event.sender.send).not.toHaveBeenCalled();
  });

  it("rejects renderer-supplied context or malformed session requests", async () => {
    const options = createOptions();
    registerIpcHandlers(options);
    const handler = getRegisteredHandler(IPC_CHANNELS.askSubmit);
    await expect(handler(createInvokeEvent(), { question: "" })).rejects.toThrow();
    await expect(
      handler(createInvokeEvent(), {
        sessionId: TEST_SESSION,
        requestId: "req-1",
        question: "Question",
        context: createAskContext()
      })
    ).rejects.toThrow();
    expect(options.askSessions.submit).not.toHaveBeenCalled();
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

    await expect(handler(createInvokeEvent(), request)).resolves.toBeUndefined();
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

function createInvokeEvent(origin = "file:///renderer") {
  const url = `${origin}/index.html`;

  return {
    senderFrame: {
      url
    },
    sender: {
      getURL: () => url,
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
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

const TEST_SESSION = "aa200e1b-8262-4c2f-b392-790792364ac1";

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

  return {
    popover,
    contextCollector,
    askSessions: {
      close: vi.fn(),
      suspend: vi.fn(),
      submit: vi.fn()
    } as unknown as AskSessions,
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
        launch: vi.fn(async () => {})
      },
      pickFolder: vi.fn(async () => null)
    },
    getSettings: vi.fn(async () => ({
      nativeShakeEnabled: false,
      devHotkeyEnabled: true,
      shakeSensitivity: "normal" as const,
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
