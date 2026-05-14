import { ipcMain } from "electron";
import {
  AskMauzRequestSchema,
  IPC_CHANNELS,
  RealtimeSessionResponseSchema
} from "@mauzai/shared";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
};

export function registerIpcHandlers({ popover, contextCollector }: RegisterIpcHandlersOptions): void {
  ipcMain.handle(IPC_CHANNELS.menuClose, () => {
    popover.hide();
  });

  ipcMain.handle(IPC_CHANNELS.menuStartAsk, () => contextCollector.collectBasicContext());
  ipcMain.handle(IPC_CHANNELS.menuStartTalk, () => contextCollector.collectBasicContext());
  ipcMain.handle(IPC_CHANNELS.menuStartScreenShare, () => contextCollector.collectBasicContext());

  ipcMain.handle(IPC_CHANNELS.askSubmit, (_event, payload: unknown) => {
    AskMauzRequestSchema.parse(payload);
    throw new Error("Ask Mauz API is not implemented in this milestone.");
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, () => {
    const unavailable = RealtimeSessionResponseSchema.safeParse({ value: "" });

    if (!unavailable.success) {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
  });
}
