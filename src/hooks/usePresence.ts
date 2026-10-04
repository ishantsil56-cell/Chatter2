import { useEffect, useState } from 'react';
import { subscribePresence } from '@/services/presence';
import { isOnline } from '@/utils/presence';
import type { PresenceState } from '@/types';

/**
 * Live presence for a user. `online` is re-evaluated every 15s so a stale
 * heartbeat flips to offline even when no new snapshot arrives.
 */
export function usePresence(uid: string | null): PresenceState | undefined {
  const [presence, setPresence] = useState<PresenceState | undefined>(undefined);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!uid) return;
    return subscribePresence(uid, setPresence);
  }, [uid]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  if (!presence) return undefined;
  return { ...presence, online: isOnline(presence) };
}
