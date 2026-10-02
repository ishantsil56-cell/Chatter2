/**
 * A tiny profile cache with shared subscriptions.
 *
 * Screens need to turn a uid into a name/avatar all the time (chat list, group
 * members, typing indicators). Rather than each screen opening its own
 * Firestore listener, this keeps one listener per uid and one shared map.
 */

import { useEffect } from 'react';
import { create } from 'zustand';
import { subscribeUser } from '@/services/users';
import type { UserProfile, UserId } from '@/types';

interface UserCacheState {
  users: Record<UserId, UserProfile>;
  setUser(profile: UserProfile): void;
}

export const useUserCache = create<UserCacheState>((set) => ({
  users: {},
  setUser: (profile) => set((s) => ({ users: { ...s.users, [profile.uid]: profile } })),
}));

const subscriptions = new Map<UserId, () => void>();

export function ensureUserSubscribed(uid: UserId): void {
  if (subscriptions.has(uid)) return;
  const unsub = subscribeUser(uid, (profile) => {
    if (profile) useUserCache.getState().setUser(profile);
  });
  subscriptions.set(uid, unsub);
}

/** Subscribe to a set of users and read them from the cache. */
export function useUsers(uids: UserId[]): Record<UserId, UserProfile> {
  const key = uids.join(',');
  const users = useUserCache((s) => s.users);

  useEffect(() => {
    uids.forEach(ensureUserSubscribed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return users;
}

export function getUserFromCache(uid: UserId): UserProfile | undefined {
  return useUserCache.getState().users[uid];
}
