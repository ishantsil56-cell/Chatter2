/**
 * Node test harness for the service layer. Import this FIRST in a test file: it
 * swaps the React Native / Firebase native modules for in-memory fakes, so the
 * real service code (messages, outbox, chats, users…) runs unmodified under Node.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import Module from 'module';
import { FakeDb } from './fakeFirestore';

export const fakeDb = new FakeDb();

/** Each simulated phone has its own AsyncStorage + keychain. */
interface Device {
  asyncStore: Map<string, string>;
  keychain: Map<string, string>;
}
const devices = new Map<string, Device>();
let cur: Device = { asyncStore: new Map(), keychain: new Map() };
devices.set('default', cur);
const appStateListeners = new Set<(s: string) => void>();
export const netListeners = new Set<(s: { isConnected: boolean }) => void>();

export const mocks: Record<string, unknown> = {
  '@react-native-firebase/firestore': Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => Date.now() } }),
  '@react-native-firebase/auth': () => ({ currentUser: null }),
  '@react-native-firebase/messaging': () => ({}),
  '@react-native-firebase/storage': () => ({}),
  '@react-native-async-storage/async-storage': {
    getItem: async (k: string) => cur.asyncStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void cur.asyncStore.set(k, v),
    removeItem: async (k: string) => void cur.asyncStore.delete(k),
    multiRemove: async (ks: string[]) => ks.forEach((k) => cur.asyncStore.delete(k)),
  },
  'react-native-keychain': {
    ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'x' },
    getGenericPassword: async ({ service }: { service: string }) =>
      cur.keychain.has(service) ? { username: 'u', password: cur.keychain.get(service) } : false,
    setGenericPassword: async (_u: string, p: string, o: { service: string }) => void cur.keychain.set(o.service, p),
    resetGenericPassword: async ({ service }: { service: string }) => void cur.keychain.delete(service),
  },
  'react-native': {
    AppState: {
      currentState: 'active',
      addEventListener: (_: string, fn: (s: string) => void) => {
        appStateListeners.add(fn);
        return { remove: () => appStateListeners.delete(fn) };
      },
    },
    Platform: { OS: 'android' },
  },
  '@react-native-community/netinfo': {
    addEventListener: (fn: (s: { isConnected: boolean }) => void) => {
      netListeners.add(fn);
      return () => netListeners.delete(fn);
    },
  },
};

const M = Module as any;
const originalLoad = M._load;
M._load = function (request: string, ...rest: unknown[]) {
  if (request in mocks) {
    const m = mocks[request];
    return typeof m === 'function' ? { __esModule: true, default: m } : { __esModule: true, default: m, ...(m as object) };
  }
  return originalLoad.call(this, request, ...rest);
};

export function emitAppState(state: string): void {
  appStateListeners.forEach((l) => l(state));
}

/** Wipe all fake device + server state between scenarios. */
export function resetWorld(): void {
  fakeDb.docs.clear();
  fakeDb.pending.clear();
  fakeDb.writeLog = [];
  fakeDb.offline = false;
  fakeDb.failNext = null;
  devices.clear();
  cur = { asyncStore: new Map(), keychain: new Map() };
  devices.set('default', cur);
}

/**
 * Switch which simulated phone the app code is "running on". Flushes and drops
 * the in-memory plaintext cache / outbox so the next phone starts cold.
 * Pass `fresh: true` to simulate a reinstall (empty storage + keychain).
 */
export async function useDevice(name: string, opts: { fresh?: boolean } = {}): Promise<void> {
  const { flushPlaintextCache, resetPlaintextCacheForTests } = await import('../messageCache');
  const { resetOutboxForTests } = await import('../outbox');
  const { resetMessageCachesForTests } = await import('../messages');
  const { forgetLocalHistoryKey } = await import('../historyKey');
  await flushPlaintextCache();
  resetPlaintextCacheForTests();
  resetOutboxForTests();
  resetMessageCachesForTests();
  if (opts.fresh || !devices.has(name)) devices.set(name, { asyncStore: new Map(), keychain: new Map() });
  cur = devices.get(name) as Device;
  // The in-memory history-key cache is per process; drop it for the "new" phone.
  for (const uid of ['alice', 'bob', 'carol']) await forgetLocalHistoryKeyMemoryOnly(uid, forgetLocalHistoryKey);
}

async function forgetLocalHistoryKeyMemoryOnly(uid: string, forget: (u: string) => Promise<void>): Promise<void> {
  // forgetLocalHistoryKey clears the memory entry AND the current device's keychain item; we
  // call it BEFORE switching storage in useDevice's caller order, so re-save is not needed here.
  const saved = [...cur.keychain.entries()];
  await forget(uid);
  for (const [k, v] of saved) cur.keychain.set(k, v);
}

export function sleep(ms = 5): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Raw values currently in the simulated phone's AsyncStorage (to prove nothing sensitive is stored in the clear). */
export function readStorage(): string[] {
  return [...cur.asyncStore.values()];
}
