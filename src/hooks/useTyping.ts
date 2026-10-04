import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { subscribeTyping, setTyping } from '@/services/chats';
import { activeTypers } from '@/utils/presence';
import type { UserId } from '@/types';

/**
 * Who is currently typing in a chat (excluding me).
 * Entries expire on a timer, so someone whose app was killed mid-sentence stops
 * showing as "typing" even though no new data arrives.
 */
export function useTyping(chatId: string | null, myUid: UserId | null): UserId[] {
  const [entries, setEntries] = useState<{ uid: string; at: number }[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!chatId || !myUid) return;
    return subscribeTyping(chatId, myUid, (rows) => {
      setEntries(rows);
      setNow(Date.now());
    });
  }, [chatId, myUid]);

  useEffect(() => {
    if (entries.length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [entries]);

  return activeTypers(entries, myUid ?? '', now);
}

const REFRESH_MS = 3000;
const IDLE_MS = 2500;

/**
 * Debounced helper to broadcast my typing state.
 *  - re-announces every few seconds while I keep typing (readers expire entries),
 *  - stops after a pause, on send, when the chat closes, and when the app backgrounds.
 * Call `dispose()` on unmount.
 */
export function createTypingReporter(chatId: string, myUid: UserId) {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let active = false;
  let lastSent = 0;

  const stop = (): void => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (active) {
      active = false;
      lastSent = 0;
      void setTyping(chatId, myUid, false);
    }
  };

  const sub = AppState.addEventListener('change', (s) => {
    if (s !== 'active') stop();
  });

  return {
    onKeystroke(): void {
      const now = Date.now();
      if (!active || now - lastSent >= REFRESH_MS) {
        active = true;
        lastSent = now;
        void setTyping(chatId, myUid, true);
      }
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(stop, IDLE_MS);
    },
    stop,
    dispose(): void {
      stop();
      sub.remove();
    },
  };
}
