/**
 * Local plaintext cache.
 *
 * Decrypting is stateful (the ratchet moves forward), so every message is
 * decrypted exactly once and its plaintext kept here — for messages we SENT
 * (we can't open our own envelope) and for messages we RECEIVED (the ratchet
 * key for it is already spent, so re-decrypting would fail).
 *
 * The whole cache is sealed with the device master key (keychain) before it
 * touches AsyncStorage, so a filesystem dump reveals nothing.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { sealLocal, openLocal } from './secureStore';
import { scope } from '@/utils/logger';

const log = scope('messageCache');
const KEY = 'chatter.plaintext.v2';
const LEGACY_KEY = 'chatter.plaintext.v1'; // was stored unencrypted
const FLUSH_DELAY_MS = 800;

let cache: Record<string, string> | null = null;
let loading: Promise<Record<string, string>> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function readFromDisk(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  // One-time migration of the old, unencrypted cache.
  const legacy = await AsyncStorage.getItem(LEGACY_KEY);
  if (legacy) {
    try {
      Object.assign(out, JSON.parse(legacy) as Record<string, string>);
      dirty = true;
    } catch {
      // ignore a corrupt legacy blob
    }
    await AsyncStorage.removeItem(LEGACY_KEY);
  }

  const blob = await AsyncStorage.getItem(KEY);
  if (blob) {
    const text = await openLocal(blob);
    if (text) {
      try {
        Object.assign(out, JSON.parse(text) as Record<string, string>);
      } catch {
        log.warn('message cache was unreadable — starting empty');
      }
    } else {
      log.warn('message cache could not be decrypted — starting empty');
    }
  }
  if (dirty) scheduleFlush();
  return out;
}

function load(): Promise<Record<string, string>> {
  if (cache) return Promise.resolve(cache);
  if (!loading) {
    loading = readFromDisk().then((c) => {
      cache = c;
      return c;
    });
  }
  return loading;
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPlaintextCache();
  }, FLUSH_DELAY_MS);
}

/** Write any pending changes now (call when the app is backgrounded). */
export async function flushPlaintextCache(): Promise<void> {
  if (!dirty || !cache) return;
  dirty = false;
  try {
    await AsyncStorage.setItem(KEY, await sealLocal(JSON.stringify(cache)));
  } catch (e) {
    dirty = true;
    log.warn('could not persist message cache', e);
  }
}

export async function putPlaintext(id: string, text: string): Promise<void> {
  const c = await load();
  if (c[id] === text) return;
  c[id] = text;
  scheduleFlush();
}

export function getPlaintextSync(id: string | null | undefined): string | undefined {
  return id ? cache?.[id] : undefined;
}

export async function getPlaintext(id: string): Promise<string | undefined> {
  return (await load())[id];
}

/** Make sure the cache is loaded (so synchronous reads work afterwards). */
export async function warmPlaintextCache(): Promise<void> {
  await load();
}

export async function clearPlaintext(): Promise<void> {
  cache = {};
  loading = null;
  dirty = false;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await AsyncStorage.multiRemove([KEY, LEGACY_KEY]);
}

/** Test hook: drop in-memory state so the next read hits storage again. */
export function resetPlaintextCacheForTests(): void {
  cache = null;
  loading = null;
  dirty = false;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
}
