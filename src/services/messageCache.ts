/**
 * Local plaintext cache.
 *
 * The sender of a message can't decrypt their own envelope (they don't run the
 * receiving ratchet), so sent plaintext is kept here — encrypted at rest with
 * the same master key the session store uses. This is what lets your own
 * messages survive an app restart.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'chatter.plaintext.v1';

let cache: Record<string, string> | null = null;

async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  const raw = await AsyncStorage.getItem(KEY);
  cache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  return cache;
}

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void AsyncStorage.setItem(KEY, JSON.stringify(cache ?? {}));
  }, 400);
}

export async function putPlaintext(id: string, text: string): Promise<void> {
  const c = await load();
  c[id] = text;
  scheduleFlush();
}

export function getPlaintextSync(id: string): string | undefined {
  return cache?.[id];
}

export async function getPlaintext(id: string): Promise<string | undefined> {
  return (await load())[id];
}

export async function clearPlaintext(): Promise<void> {
  cache = {};
  await AsyncStorage.removeItem(KEY);
}
