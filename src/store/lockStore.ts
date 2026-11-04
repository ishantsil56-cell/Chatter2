/**
 * Lock state and preferences.
 *
 * Presentation and local state only — nothing here touches messages, keys or
 * auth. Kept in its own store so the gate can re-render without disturbing the
 * data layer.
 */

import { create } from 'zustand';
import {
  COOLDOWN_BASE_MS,
  DEFAULT_PREFS,
  MAX_ATTEMPTS_BEFORE_COOLDOWN,
  hasPin,
  loadCooldown,
  loadPrefs,
  saveCooldown,
  savePrefs,
  type LockPrefs,
} from '@/services/appLock';
import { scope } from '@/utils/logger';

const log = scope('lockStore');

export type LockStatus = 'locked' | 'unlocking' | 'unlocked';

interface LockState {
  /** False until the stored preferences have been read. */
  hydrated: boolean;
  status: LockStatus;
  prefs: LockPrefs;
  /** Epoch ms until which entry is refused. */
  lockedUntil: number;
  failedAttempts: number;
  /** A chat a notification asked for, held until the gate clears. */
  pendingChatId: string | null;
  /** Whether the background cover is drawn right now. */
  coverVisible: boolean;

  hydrate(): Promise<void>;
  lockNow(): void;
  beginUnlock(): void;
  unlock(): void;
  failAttempt(): Promise<void>;
  clearFailures(): Promise<void>;
  setPrefs(next: Partial<LockPrefs>): Promise<void>;
  setPendingChat(chatId: string | null): void;
  setCover(visible: boolean): void;
  noteBackground(): void;
  noteForeground(): void;
}

/** When the app last went to the background, for the grace-period rule. */
let backgroundedAt: number | null = null;

export const useLockStore = create<LockState>((set, get) => ({
  hydrated: false,
  // Start locked. If there is no PIN, hydrate opens the gate immediately; if
  // there is one, the first frame must never show a conversation.
  status: 'locked',
  prefs: DEFAULT_PREFS,
  lockedUntil: 0,
  failedAttempts: 0,
  pendingChatId: null,
  coverVisible: false,

  hydrate: async () => {
    try {
      const [prefs, pinSet, lockedUntil] = await Promise.all([
        loadPrefs(),
        hasPin(),
        loadCooldown(),
      ]);
      // A preference that says "enabled" with no PIN behind it would lock the
      // user out of their own app permanently, so the PIN is the source of
      // truth for whether a gate exists at all.
      const enabled = prefs.enabled && pinSet;
      set({
        prefs: { ...prefs, enabled },
        lockedUntil,
        hydrated: true,
        status: enabled ? 'locked' : 'unlocked',
      });
    } catch (e) {
      // Fail closed, but do not strand anyone: a broken read means no PIN we can
      // verify, so treat the app as unlocked rather than bricking it.
      log.warn('could not hydrate the lock', e);
      set({ hydrated: true, status: 'unlocked' });
    }
  },

  lockNow: () => {
    const { prefs, status } = get();
    if (!prefs.enabled || status === 'locked') return;
    set({ status: 'locked', failedAttempts: 0 });
  },

  beginUnlock: () => {
    if (get().status !== 'locked') return;
    set({ status: 'unlocking' });
  },

  unlock: () => {
    set({ status: 'unlocked', failedAttempts: 0, lockedUntil: 0 });
    void saveCooldown(0);
  },

  failAttempt: async () => {
    const failed = get().failedAttempts + 1;
    if (failed < MAX_ATTEMPTS_BEFORE_COOLDOWN) {
      set({ status: 'locked', failedAttempts: failed });
      return;
    }
    // Back off harder the more times it has happened, capped so it stays
    // recoverable rather than punishing.
    const rounds = Math.floor(failed / MAX_ATTEMPTS_BEFORE_COOLDOWN);
    const until = Date.now() + Math.min(COOLDOWN_BASE_MS * rounds, 10 * 60_000);
    set({ status: 'locked', failedAttempts: failed, lockedUntil: until });
    await saveCooldown(until);
  },

  clearFailures: async () => {
    set({ failedAttempts: 0, lockedUntil: 0 });
    await saveCooldown(0);
  },

  setPrefs: async (next) => {
    const merged = { ...get().prefs, ...next };
    set({ prefs: merged });
    await savePrefs(merged);
  },

  setPendingChat: (pendingChatId) => set({ pendingChatId }),

  setCover: (coverVisible) => set({ coverVisible }),

  noteBackground: () => {
    backgroundedAt = Date.now();
    // The cover goes up immediately; whether the gate then locks is decided on
    // the way back in, once we know how long we were away.
    set({ coverVisible: true });
  },

  noteForeground: () => {
    set({ coverVisible: false });
    const { prefs, status } = get();
    if (!prefs.enabled || status === 'locked') {
      backgroundedAt = null;
      return;
    }
    // -1 is "never": the user asked not to be locked out on switching apps.
    if (prefs.autoLockMs < 0) {
      backgroundedAt = null;
      return;
    }
    const away = backgroundedAt === null ? 0 : Date.now() - backgroundedAt;
    backgroundedAt = null;
    if (prefs.autoLockMs === 0 || away >= prefs.autoLockMs) {
      set({ status: 'locked', failedAttempts: 0 });
    }
  },
}));
