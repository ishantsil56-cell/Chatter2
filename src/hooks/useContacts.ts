import { friendlyError } from '@/utils/errors';
import { useCallback, useState } from 'react';
import { searchUsersByUsername } from '@/services/users';
import { ensureDirectChat } from '@/services/chats';
import { normalizeUsername } from '@/utils/username';
import type { Contact } from '@/types';

/** Search people by username and start direct chats. */
export function useContacts(myUid: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Prefix search — returns everyone whose handle starts with what you typed. */
  const search = useCallback(
    async (query: string): Promise<Contact[]> => {
      setError(null);
      const prefix = normalizeUsername(query);
      if (!prefix) {
        setError('Type a username to search.');
        return [];
      }
      const results = await searchUsersByUsername(prefix);
      const others = results.filter((c) => c.uid !== myUid);
      if (others.length === 0) setError('No one found with that username.');
      return others;
    },
    [myUid],
  );

  const startDirectChat = useCallback(
    async (peerUid: string): Promise<string | null> => {
      if (!myUid) return null;
      setBusy(true);
      setError(null);
      try {
        return await ensureDirectChat(myUid, peerUid);
      } catch (e) {
        setError(friendlyError(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [myUid],
  );

  return { search, startDirectChat, busy, error };
}
