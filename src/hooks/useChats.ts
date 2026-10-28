import { useCallback, useEffect, useState } from 'react';
import { subscribeChats } from '@/services/chats';
import { friendlyError } from '@/utils/errors';
import type { Chat } from '@/types';

/**
 * Live list of the current user's chats, newest first.
 *
 * The failure mode matters as much as the data: previously a listener error
 * (denied read, offline, missing index) only reached the log, so `loading`
 * stayed true forever and the home screen rendered a blank list with no
 * explanation. Now an error clears loading, reports itself, and offers a
 * retry — a failed load must never look like an empty account.
 */
export function useChats(uid: string | null): {
  chats: Chat[];
  loading: boolean;
  error: string | null;
  retry: () => void;
} {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setToken((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!uid) {
      setChats([]);
      setLoading(false);
      return;
    }
    const unsub = subscribeChats(
      uid,
      (next) => {
        setChats(next);
        setError(null);
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err));
        setLoading(false);
      },
    );
    return unsub;
  }, [uid, token]);

  return { chats, loading, error, retry };
}
