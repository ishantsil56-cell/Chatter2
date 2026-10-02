import { useEffect, useState } from 'react';
import { subscribeChats } from '@/services/chats';
import type { Chat } from '@/types';

/** Live list of the current user's chats, newest first. */
export function useChats(uid: string | null): { chats: Chat[]; loading: boolean } {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setChats([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeChats(uid, (next) => {
      setChats(next);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  return { chats, loading };
}
