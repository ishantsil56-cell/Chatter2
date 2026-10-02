import { useEffect, useState } from 'react';
import { subscribePresence } from '@/services/presence';
import type { PresenceState } from '@/types';

/** Live presence for a user. */
export function usePresence(uid: string | null): PresenceState | undefined {
  const [presence, setPresence] = useState<PresenceState | undefined>(undefined);

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribePresence(uid, setPresence);
    return unsub;
  }, [uid]);

  return presence;
}
