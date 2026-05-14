import { ipcMain } from "electron";
import {
  IPC_CHANNELS,
  MauzSettingsUpdateSchema,
  RealtimeSessionResponseSchema,
  type MauzSettings,
  type MauzSettingsUpdate
} from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import { submitAskToLocalApi } from "./askApiClient";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
  api: LocalApiHandle;
  localApiToken: string;
  getSettings: () => Promise<MauzSettings>;
  updateSettings: (update: MauzSettingsUpdate) => Promise<MauzSettings>;
};

const HANDLED_IPC_CHANNELS = [
  IPC_CHANNELS.menuShowMenu,
  IPC_CHANNELS.menuClose,
  IPC_CHANNELS.menuStartAsk,
  IPC_CHANNELS.menuStartTalk,
  IPC_CHANNELS.menuStartScreenShare,
  IPC_CHANNELS.settingsOpen,
  IPC_CHANNELS.settingsUpdate,
  IPC_CHANNELS.askSubmit,
  IPC_CHANNELS.realtimeCreateSession
] as const;

export function registerIpcHandlers({
  popover,
  contextCollector,
  api,
  localApiToken,
  getSettings,
  updateSettings
}: RegisterIpcHandlersOptions): void {
  for (const channel of HANDLED_IPC_CHANNELS) {
    ipcMain.removeHandler(channel);
  }

  ipcMain.handle(IPC_CHANNELS.menuShowMenu, () => {
    popover.resizeForMenu();
  });

  ipcMain.handle(IPC_CHANNELS.menuClose, () => {
    popover.hide();
  });

  ipcMain.handle(IPC_CHANNELS.menuStartAsk, async () => {
    const context = await contextCollector.collectForAsk();
    popover.resizeForAsk();
    return context;
  });
  ipcMain.handle(IPC_CHANNELS.menuStartTalk, () => contextCollector.collectBasicContext());
  ipcMain.handle(IPC_CHANNELS.menuStartScreenShare, () => contextCollector.collectBasicContext());

  ipcMain.handle(IPC_CHANNELS.settingsOpen, async () => {
    popover.resizeForSettings();
    return getSettings();
  });

  ipcMain.handle(IPC_CHANNELS.settingsUpdate, async (_event, payload: unknown) => {
    const parsedPayload = MauzSettingsUpdateSchema.safeParse(payload);

    if (!parsedPayload.success) {
      throw new Error("Invalid Mauz settings update.");
    }

    return updateSettings(toSettingsUpdate(parsedPayload.data));
  });

  ipcMain.handle(IPC_CHANNELS.askSubmit, async (_event, payload: unknown) => {
    return submitAskToLocalApi(api, localApiToken, payload);
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, () => {
    const unavailable = RealtimeSessionResponseSchema.safeParse({ value: "" });

    if (!unavailable.success) {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
  });
}

function toSettingsUpdate(parsedUpdate: {
  nativeShakeEnabled?: boolean | undefined;
  devHotkeyEnabled?: boolean | undefined;
  shakeSensitivity?: MauzSettings["shakeSensitivity"] | undefined;
}): MauzSettingsUpdate {
  const update: MauzSettingsUpdate = {};

  if (parsedUpdate.nativeShakeEnabled !== undefined) {
    update.nativeShakeEnabled = parsedUpdate.nativeShakeEnabled;
  }

  if (parsedUpdate.devHotkeyEnabled !== undefined) {
    update.devHotkeyEnabled = parsedUpdate.devHotkeyEnabled;
  }

  if (parsedUpdate.shakeSensitivity !== undefined) {
    update.shakeSensitivity = parsedUpdate.shakeSensitivity;
  }

  return update;
}
