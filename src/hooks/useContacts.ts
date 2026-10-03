import { useCallback, useState } from 'react';
import { findUserByEmail, findUsersByEmails } from '@/services/users';
import { ensureDirectChat } from '@/services/chats';
import { isValidEmail, normalizeEmail } from '@/utils/email';
import type { Contact } from '@/types';

/** Look up contacts by email address and start direct chats. */
export function useContacts(myUid: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(async (rawEmail: string): Promise<Contact | null> => {
    setError(null);
    const email = normalizeEmail(rawEmail);
    if (!isValidEmail(email)) {
      setError('Enter a valid email address.');
      return null;
    }
    const contact = await findUserByEmail(email);
    if (!contact) setError('No Chatter user with that email.');
    return contact;
  }, []);

  const lookupMany = useCallback(async (emails: string[]): Promise<Contact[]> => {
    return findUsersByEmails(emails);
  }, []);

  const startDirectChat = useCallback(
    async (peerUid: string): Promise<string | null> => {
      if (!myUid) return null;
      setBusy(true);
      setError(null);
      try {
        return await ensureDirectChat(myUid, peerUid);
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [myUid],
  );

  return { lookup, lookupMany, startDirectChat, busy, error };
}
