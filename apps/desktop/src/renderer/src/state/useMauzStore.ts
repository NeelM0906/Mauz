import { create } from "zustand";
import type { MauzDesktopContext, MauzSettings } from "@mauzai/shared";

type MauzMode = "menu" | "ask" | "talk" | "screen" | "settings";

type MauzStore = {
  mode: MauzMode;
  status: string | null;
  currentContext: MauzDesktopContext | null;
  askAnswer: string | null;
  askError: string | null;
  askLoading: boolean;
  settings: MauzSettings | null;
  setMode(mode: MauzMode): void;
  setStatus(status: string | null): void;
  setCurrentContext(context: MauzDesktopContext | null): void;
  setAskAnswer(answer: string | null): void;
  setAskError(error: string | null): void;
  setAskLoading(loading: boolean): void;
  setSettings(settings: MauzSettings | null): void;
  backToMenu(): void;
  reset(): void;
};

export const useMauzStore = create<MauzStore>((set) => ({
  mode: "menu",
  status: null,
  currentContext: null,
  askAnswer: null,
  askError: null,
  askLoading: false,
  settings: null,
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setCurrentContext: (currentContext) => set({ currentContext }),
  setAskAnswer: (askAnswer) => set({ askAnswer }),
  setAskError: (askError) => set({ askError }),
  setAskLoading: (askLoading) => set({ askLoading }),
  setSettings: (settings) => set({ settings }),
  backToMenu: () =>
    set({
      mode: "menu",
      status: null,
      askAnswer: null,
      askError: null,
      askLoading: false
    }),
  reset: () =>
    set({
      mode: "menu",
      status: null,
      currentContext: null,
      askAnswer: null,
      askError: null,
      askLoading: false
    })
}));
