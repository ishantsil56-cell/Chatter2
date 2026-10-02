/**
 * Presence: online/offline + last-seen.
 *
 * Presence is written to users/{uid}.presence. While the app is foregrounded we
 * heartbeat every 25s; when it backgrounds we mark offline with a lastSeen.
 * (Firestore isn't ideal for presence — Realtime Database or a TTL'd doc would
 * be cheaper at scale — but this keeps the stack to one database.)
 */

import { AppState, type AppStateStatus } from 'react-native';
import { db } from './firebase';
import { setPresence } from './users';
import type { PresenceState } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('presence');
const HEARTBEAT_MS = 25_000;

let timer: ReturnType<typeof setInterval> | null = null;
let subscription: { remove: () => void } | null = null;
let currentUid: string | null = null;

export function startPresence(uid: string): void {
  stopPresence();
  currentUid = uid;

  const goOnline = () => void setPresence(uid, { online: true, lastSeen: Date.now() });
  const goOffline = () => void setPresence(uid, { online: false, lastSeen: Date.now() });

  goOnline();
  timer = setInterval(goOnline, HEARTBEAT_MS);

  subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (state === 'active') goOnline();
    else goOffline();
  });
  log.info('presence started');
}

export function stopPresence(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (subscription) {
    subscription.remove();
    subscription = null;
  }
  if (currentUid) {
    void setPresence(currentUid, { online: false, lastSeen: Date.now() });
  }
  currentUid = null;
}

export function subscribePresence(uid: string, cb: (presence: PresenceState | undefined) => void): () => void {
  return db
    .collection('users')
    .doc(uid)
    .onSnapshot((snap) => cb(snap.data()?.presence as PresenceState | undefined));
}
