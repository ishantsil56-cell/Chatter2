import { useCallback, useState } from 'react';
import { findUserByPhone, findUsersByPhones } from '@/services/users';
import { ensureDirectChat } from '@/services/chats';
import { toE164 } from '@/utils/phone';
import type { Contact } from '@/types';

/** Look up contacts by phone number and start direct chats. */
export function useContacts(myUid: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = useCallback(
    async (rawPhone: string, countryCode: string): Promise<Contact | null> => {
      setError(null);
      const e164 = toE164(rawPhone, countryCode);
      const contact = await findUserByPhone(e164);
      if (!contact) setError('No Chatter user with that number.');
      return contact;
    },
    [],
  );

  const lookupMany = useCallback(async (phones: string[]): Promise<Contact[]> => {
    return findUsersByPhones(phones);
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
