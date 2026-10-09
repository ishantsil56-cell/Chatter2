import { useEffect, useState } from 'react';
import { subscribeContacts } from '@/services/contacts';
import type { SavedContact, UserId } from '@/types';

/** Live list of the user's saved contacts. */
export function useSavedContacts(uid: UserId | null): {
  contacts: SavedContact[];
  loading: boolean;
} {
  const [contacts, setContacts] = useState<SavedContact[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setContacts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return subscribeContacts(uid, (list) => {
      setContacts(list);
      setLoading(false);
    });
  }, [uid]);

  return { contacts, loading };
}
