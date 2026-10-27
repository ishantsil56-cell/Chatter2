import { useEffect, useState } from 'react';
import { subscribeChatPrefs, type ChatPrefs } from '@/services/chatPrefs';
import type { ChatId, UserId } from '@/types';

/** The signed-in user's per-chat preferences, live. Empty until the first snapshot. */
export function useChatPrefs(uid: string | null): Record<ChatId, ChatPrefs> {
  const [prefs, setPrefs] = useState<Record<ChatId, ChatPrefs>>({});
  useEffect(() => {
    if (!uid) {
      setPrefs({});
      return;
    }
    return subscribeChatPrefs(uid, setPrefs, () => undefined);
  }, [uid]);
  return prefs;
}

export type { ChatPrefs };
