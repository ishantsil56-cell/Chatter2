import { useEffect, useState } from 'react';
import { subscribeBlocks } from '@/services/blocks';
import type { UserId } from '@/types';

/** The uids the signed-in user blocked, live. Empty until the first snapshot. */
export function useBlocked(uid: string | null): Set<UserId> {
  const [blocked, setBlocked] = useState<Set<UserId>>(new Set());
  useEffect(() => {
    if (!uid) {
      setBlocked(new Set());
      return;
    }
    return subscribeBlocks(uid, (uids) => setBlocked(new Set(uids)));
  }, [uid]);
  return blocked;
}
