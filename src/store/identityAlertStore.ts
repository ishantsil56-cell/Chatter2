/**
 * Identity-key changes.
 *
 * When a peer's identity key changes, `session.ts` refuses to keep using the old
 * session — correctly, because a changed key is exactly what a man in the middle
 * looks like. But refusing is only half the job: if nobody tells the user, the
 * signal is wasted and the change looks like an ordinary unreadable message.
 *
 * So the change is recorded here and surfaced as a banner in that chat until it
 * is dismissed by verifying the safety number.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scope } from '@/utils/logger';

const log = scope('identityAlerts');
const KEY = 'iris.identityAlerts.v1';

export interface IdentityAlert {
  peerId: string;
  /** The key we had trusted. */
  previousKey: string;
  /** The key the peer is presenting now. */
  currentKey: string;
  at: number;
}

interface State {
  alerts: Record<string, IdentityAlert>;
  hydrated: boolean;
  hydrate(): Promise<void>;
  record(peerId: string, previousKey: string, currentKey: string): Promise<void>;
  dismiss(peerId: string): Promise<void>;
}

async function persist(alerts: Record<string, IdentityAlert>): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(alerts));
  } catch (e) {
    log.warn('could not save identity alerts', e);
  }
}

export const useIdentityAlertStore = create<State>((set, get) => ({
  alerts: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const saved = raw ? (JSON.parse(raw) as Record<string, IdentityAlert>) : {};
      set({ alerts: saved, hydrated: true });
    } catch (e) {
      log.warn('could not read identity alerts', e);
      set({ hydrated: true });
    }
  },

  record: async (peerId, previousKey, currentKey) => {
    // Repeating the same change (a retry, or a re-render) must not overwrite the
    // timestamp or resurrect a dismissed alert for an older key.
    const existing = get().alerts[peerId];
    if (existing && existing.currentKey === currentKey) return;
    const next: Record<string, IdentityAlert> = {
      ...get().alerts,
      [peerId]: { peerId, previousKey, currentKey, at: Date.now() },
    };
    set({ alerts: next });
    await persist(next);
  },

  dismiss: async (peerId) => {
    const next = { ...get().alerts };
    delete next[peerId];
    set({ alerts: next });
    await persist(next);
  },
}));
