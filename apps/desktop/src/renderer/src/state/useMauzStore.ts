import { create } from "zustand";

type MauzMode = "menu" | "ask" | "talk" | "screen";

type MauzStore = {
  mode: MauzMode;
  status: string | null;
  setMode(mode: MauzMode): void;
  setStatus(status: string | null): void;
  reset(): void;
};

export const useMauzStore = create<MauzStore>((set) => ({
  mode: "menu",
  status: null,
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  reset: () => set({ mode: "menu", status: null })
}));
