import { create } from "zustand";
import type {
  ChatConversation,
  ChatHistoryListResponse,
  MauzDesktopContext,
  MauzSettings
} from "@mauzai/shared";

type MauzMode = "menu" | "ask" | "talk" | "settings" | "history";

type MauzStore = {
  mode: MauzMode;
  status: string | null;
  currentContext: MauzDesktopContext | null;
  askAnswer: string | null;
  askConversationTitle: string | null;
  askError: string | null;
  askLoading: boolean;
  chatHistory: ChatHistoryListResponse | null;
  selectedConversation: ChatConversation | null;
  historyError: string | null;
  historyLoading: boolean;
  settings: MauzSettings | null;
  setMode(mode: MauzMode): void;
  setStatus(status: string | null): void;
  setCurrentContext(context: MauzDesktopContext | null): void;
  setAskAnswer(answer: string | null): void;
  setAskConversationTitle(title: string | null): void;
  setAskError(error: string | null): void;
  setAskLoading(loading: boolean): void;
  setChatHistory(history: ChatHistoryListResponse | null): void;
  setSelectedConversation(conversation: ChatConversation | null): void;
  setHistoryError(error: string | null): void;
  setHistoryLoading(loading: boolean): void;
  setSettings(settings: MauzSettings | null): void;
  backToMenu(): void;
  reset(): void;
};

export const useMauzStore = create<MauzStore>((set) => ({
  mode: "menu",
  status: null,
  currentContext: null,
  askAnswer: null,
  askConversationTitle: null,
  askError: null,
  askLoading: false,
  chatHistory: null,
  selectedConversation: null,
  historyError: null,
  historyLoading: false,
  settings: null,
  setMode: (mode) => set({ mode }),
  setStatus: (status) => set({ status }),
  setCurrentContext: (currentContext) => set({ currentContext }),
  setAskAnswer: (askAnswer) => set({ askAnswer }),
  setAskConversationTitle: (askConversationTitle) => set({ askConversationTitle }),
  setAskError: (askError) => set({ askError }),
  setAskLoading: (askLoading) => set({ askLoading }),
  setChatHistory: (chatHistory) => set({ chatHistory }),
  setSelectedConversation: (selectedConversation) => set({ selectedConversation }),
  setHistoryError: (historyError) => set({ historyError }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
  setSettings: (settings) => set({ settings }),
  backToMenu: () =>
    set({
      mode: "menu",
      status: null,
      askAnswer: null,
      askConversationTitle: null,
      askError: null,
      askLoading: false,
      selectedConversation: null,
      historyError: null,
      historyLoading: false
    }),
  reset: () =>
    set({
      mode: "menu",
      status: null,
      currentContext: null,
      askAnswer: null,
      askConversationTitle: null,
      askError: null,
      askLoading: false,
      selectedConversation: null,
      historyError: null,
      historyLoading: false
    })
}));
