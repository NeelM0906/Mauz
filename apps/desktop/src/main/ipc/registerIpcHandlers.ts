import { ipcMain } from "electron";
import {
  AskMauzResponseSchema,
  AskMauzRequestSchema,
  IPC_CHANNELS,
  RealtimeSessionResponseSchema
} from "@mauzai/shared";
import type { LocalApiHandle } from "../server/launchLocalApi";
import type { PopoverWindowController } from "../windows/PopoverWindowController";
import type { ContextCollector } from "../context/ContextCollector";

type RegisterIpcHandlersOptions = {
  popover: PopoverWindowController;
  contextCollector: ContextCollector;
  api: LocalApiHandle;
};

export function registerIpcHandlers({ popover, contextCollector, api }: RegisterIpcHandlersOptions): void {
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
    const request = AskMauzRequestSchema.parse(payload);
    const response = await fetch(`${api.baseUrl}/api/ask`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(request)
    });
    const body = (await response.json()) as unknown;

    if (!response.ok) {
      const errorMessage =
        typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
          ? body.error
          : "Ask Mauz failed.";

      throw new Error(errorMessage);
    }

    return AskMauzResponseSchema.parse(body);
  });

  ipcMain.handle(IPC_CHANNELS.realtimeCreateSession, () => {
    const unavailable = RealtimeSessionResponseSchema.safeParse({ value: "" });

    if (!unavailable.success) {
      throw new Error("Realtime API is not implemented in this milestone.");
    }
  });
}
