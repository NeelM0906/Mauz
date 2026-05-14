import { ipcMain } from "electron";
import { IPC_CHANNELS, RealtimeSessionResponseSchema } from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";
import { submitAskToLocalApi } from "./askApiClient";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
  api: LocalApiHandle;
  localApiToken: string;
};

export function registerIpcHandlers({
  popover,
  contextCollector,
  api,
  localApiToken
}: RegisterIpcHandlersOptions): void {
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
