/**
 * Unread totals for the tab bar.
 *
 * The tab bar needs a number, but the chats themselves live in a Firestore
 * subscription owned by the chat list. Rather than open a SECOND subscription
 * just to count rows, the list publishes its totals here and the bar reads them.
 * One listener, two consumers.
 *
 * The chat list stays mounted while you are on another tab (that is how tab
 * navigators work), so its subscription — and therefore these numbers — stay
 * live even when Chats is not on screen.
 */

import { create } from 'zustand';

interface ChatBadgeState {
  /** Chats with a message newer than your read cursor. */
  unread: number;
  /** Of those, how many have your handle mentioned in the newest message. */
  mentions: number;
  set(unread: number, mentions: number): void;
  clear(): void;
}

export const useChatBadgeStore = create<ChatBadgeState>((set) => ({
  unread: 0,
  mentions: 0,
  set: (unread, mentions) => set({ unread, mentions }),
  clear: () => set({ unread: 0, mentions: 0 }),
}));
