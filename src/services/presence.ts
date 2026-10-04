/**
 * Presence: online/offline + last-seen.
 *
 * Written to users/{uid}.presence. While the app is in the foreground we
 * heartbeat every 25s. Readers only trust `online` while the heartbeat is fresh
 * (see utils/presence.ts), so a killed app or a dead connection can never leave
 * someone looking online forever.
 *
 * Robustness rules:
 *  - The heartbeat timer is STOPPED while backgrounded (a timer firing in the
 *    background would flip us back to "online").
 *  - We go online on foreground and when connectivity returns.
 *  - All writes are best-effort and never throw.
 */

import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { db } from './firebase';
import { setPresence } from './users';
import type { PresenceState } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('presence');
const HEARTBEAT_MS = 25_000;

let timer: ReturnType<typeof setInterval> | null = null;
let appSub: { remove: () => void } | null = null;
let netUnsub: (() => void) | null = null;
let currentUid: string | null = null;
let foreground = true;

function beat(): void {
  if (currentUid && foreground) void setPresence(currentUid, { online: true, lastSeen: Date.now() });
}

function startTimer(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(beat, HEARTBEAT_MS);
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function startPresence(uid: string): void {
  stopPresence(false);
  currentUid = uid;
  foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

  if (foreground) {
    beat();
    startTimer();
  }

  appSub = AppState.addEventListener('change', (state: AppStateStatus) => {
    if (!currentUid) return;
    if (state === 'active') {
      foreground = true;
      beat();
      startTimer();
    } else {
      foreground = false;
      stopTimer();
      void setPresence(currentUid, { online: false, lastSeen: Date.now() });
    }
  });

  netUnsub = NetInfo.addEventListener((s) => {
    if (s.isConnected) beat();
  });
  log.info('presence started');
}

export function stopPresence(markOffline = true): void {
  stopTimer();
  appSub?.remove();
  appSub = null;
  netUnsub?.();
  netUnsub = null;
  if (markOffline && currentUid) {
    void setPresence(currentUid, { online: false, lastSeen: Date.now() });
  }
  currentUid = null;
}

export function subscribePresence(uid: string, cb: (presence: PresenceState | undefined) => void): () => void {
  return db
    .collection('users')
    .doc(uid)
    .onSnapshot(
      (snap) => cb(snap.data()?.presence as PresenceState | undefined),
      (err) => log.debug('presence subscription error', err),
    );
}
