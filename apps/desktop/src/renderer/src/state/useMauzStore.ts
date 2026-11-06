import { create } from "zustand";
import type { MauzDesktopContext, MauzSettings } from "@mauzai/shared";

type MauzMode = "menu" | "lens" | "task" | "dictate" | "settings";

type MauzStore = {
  mode: MauzMode;
  status: string | null;
  currentContext: MauzDesktopContext | null;
  askAnswer: string | null;
  askError: string | null;
  askLoading: boolean;
  settings: MauzSettings | null;
  /** Dictated text handed to Ask (sent right away) or Send to agent (prefilled). */
  dictation: string | null;
  setMode(mode: MauzMode): void;
  setStatus(status: string | null): void;
  setCurrentContext(context: MauzDesktopContext | null): void;
  setAskAnswer(answer: string | null): void;
  setAskError(error: string | null): void;
  setAskLoading(loading: boolean): void;
  setSettings(settings: MauzSettings | null): void;
  setDictation(text: string | null): void;
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
  dictation: null,
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setCurrentContext: (currentContext) => set({ currentContext }),
  setAskAnswer: (askAnswer) => set({ askAnswer }),
  setAskError: (askError) => set({ askError }),
  setAskLoading: (askLoading) => set({ askLoading }),
  setSettings: (settings) => set({ settings }),
  setDictation: (dictation) => set({ dictation }),
  backToMenu: () =>
    set({
      mode: "menu",
      status: null,
      askAnswer: null,
      askError: null,
      askLoading: false,
      dictation: null
    }),
  reset: () =>
    set({
      mode: "menu",
      status: null,
      currentContext: null,
      askAnswer: null,
      askError: null,
      askLoading: false,
      dictation: null
    })
}));
