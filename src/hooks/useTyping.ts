import { useEffect, useState } from 'react';
import { subscribeTyping, setTyping } from '@/services/chats';
import type { UserId } from '@/types';

/** Who is currently typing in a chat (excluding me). */
export function useTyping(chatId: string | null, myUid: UserId | null): UserId[] {
  const [typingUids, setTypingUids] = useState<UserId[]>([]);

  useEffect(() => {
    if (!chatId || !myUid) return;
    const unsub = subscribeTyping(chatId, myUid, setTypingUids);
    return unsub;
  }, [chatId, myUid]);

  return typingUids;
}

/** Debounced helper to broadcast my typing state. */
export function createTypingReporter(chatId: string, myUid: UserId) {
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  let active = false;

  return {
    onKeystroke(): void {
      if (!active) {
        active = true;
        void setTyping(chatId, myUid, true);
      }
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        active = false;
        void setTyping(chatId, myUid, false);
      }, 2500);
    },
    stop(): void {
      if (stopTimer) clearTimeout(stopTimer);
      active = false;
      void setTyping(chatId, myUid, false);
    },
  };
}
