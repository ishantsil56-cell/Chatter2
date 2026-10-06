/**
 * Which chat is currently on screen.
 *
 * Used only to decide whether a notification is worth showing: buzzing someone
 * about a message they are already reading is pure noise. Kept in a tiny store
 * because the notification code runs outside React.
 */

import { create } from 'zustand';

interface ActiveChatState {
  activeChatId: string | null;
  setActiveChatId(id: string | null): void;
}

export const useActiveChatStore = create<ActiveChatState>((set) => ({
  activeChatId: null,
  setActiveChatId: (activeChatId) => set({ activeChatId }),
}));
