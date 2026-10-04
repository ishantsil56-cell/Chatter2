/**
 * Outbox: every message goes through here, so the UI can always show whether it
 * is sending, failed, or sent.
 *
 * Lifecycle of an item:
 *   queued -> sending (encrypting / writing) -> removed once the server acks it
 *                                  \-> failed (error kept; retried on reconnect,
 *                                      or by the user with Retry / Discard)
 *
 * Encryption happens ONCE, then the prepared (ciphertext) message is stored and
 * only re-written on retry — so retries never advance the ratchet again or
 * create duplicates (the Firestore document id is fixed per message).
 *
 * The queue is sealed with the device master key before touching AsyncStorage,
 * because it holds message plaintext until the send completes.
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { prepareMessage, startCommit, type PreparedMessage, type SendParams } from './messages';
import { sealLocal, openLocal } from './secureStore';
import { randomId } from '@/utils/id';
import { friendlyError } from '@/utils/errors';
import type { SessionManager } from './crypto/session';
import { scope } from '@/utils/logger';

const log = scope('outbox');
const KEY = 'chatter.outbox.v2';
const LEGACY_KEY = 'chatter.outbox.v1';
const AUTO_RETRY_LIMIT = 8;

export type OutboxState = 'queued' | 'sending' | 'failed';

export interface OutboxItem {
  /** Also the Firestore document id of the message. */
  id: string;
  params: SendParams & { clientId: string; createdAt: number };
  prepared?: PreparedMessage;
  state: OutboxState;
  attempts: number;
  /** Raw and friendly description of the last failure. */
  lastError?: string;
  friendlyError?: string;
}

let queue: OutboxItem[] = [];
let loaded: Promise<void> | null = null;
let engine: SessionManager | null = null;
const running = new Set<string>();
const listeners = new Set<(items: OutboxItem[]) => void>();
let persistChain: Promise<void> = Promise.resolve();

function notify(): void {
  const snapshot = queue.slice();
  listeners.forEach((l) => l(snapshot));
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      const blob = await AsyncStorage.getItem(KEY);
      if (blob) {
        const text = await openLocal(blob);
        if (text) {
          try {
            queue = (JSON.parse(text) as OutboxItem[]).map((i) => ({ ...i, state: 'queued' as const }));
          } catch {
            log.warn('outbox unreadable — starting empty');
          }
        }
      }
      // v1 stored plaintext params only; carry any survivors forward.
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy) {
        try {
          const old = JSON.parse(legacy) as { id: string; params: SendParams }[];
          for (const o of old) {
            const clientId = randomId(16);
            queue.push({
              id: clientId,
              params: { ...o.params, clientId, createdAt: o.params.createdAt ?? Date.now() },
              state: 'queued',
              attempts: 0,
            });
          }
        } catch {
          // ignore
        }
        await AsyncStorage.removeItem(LEGACY_KEY);
      }
      notify();
    })();
  }
  return loaded;
}

function persist(): Promise<void> {
  // Serialise writes so an older snapshot can never land after a newer one.
  persistChain = persistChain.then(async () => {
    try {
      await AsyncStorage.setItem(KEY, await sealLocal(JSON.stringify(queue)));
    } catch (e) {
      log.warn('could not persist outbox', e);
    }
  });
  return persistChain;
}

export function getOutbox(): OutboxItem[] {
  return queue.slice();
}

export function subscribeOutbox(cb: (items: OutboxItem[]) => void): () => void {
  listeners.add(cb);
  void load().then(() => cb(queue.slice()));
  return () => {
    listeners.delete(cb);
  };
}

export async function pendingCount(): Promise<number> {
  await load();
  return queue.length;
}

/** Add a message to the outbox and start sending it. Returns immediately. */
export async function enqueue(params: SendParams): Promise<OutboxItem> {
  await load();
  const clientId = params.clientId ?? randomId(16);
  const item: OutboxItem = {
    id: clientId,
    params: { ...params, clientId, createdAt: params.createdAt ?? Date.now() },
    state: 'queued',
    attempts: 0,
  };
  queue.push(item);
  notify();
  await persist();
  log.info(`queued message ${item.id} (${queue.length} in outbox)`);
  void process(item);
  return item;
}

async function remove(id: string): Promise<void> {
  queue = queue.filter((i) => i.id !== id);
  notify();
  await persist();
}

async function fail(item: OutboxItem, e: unknown): Promise<void> {
  item.state = 'failed';
  item.lastError = e instanceof Error ? e.message : String(e);
  item.friendlyError = friendlyError(e);
  log.warn(`message ${item.id} failed (attempt ${item.attempts}): ${item.lastError}`);
  notify();
  await persist();
}

async function process(item: OutboxItem): Promise<void> {
  if (running.has(item.id) || !engine) return;
  running.add(item.id);
  const crypto = engine;
  try {
    item.state = 'sending';
    item.attempts += 1;
    item.lastError = undefined;
    item.friendlyError = undefined;
    notify();

    if (!item.prepared) {
      item.prepared = await prepareMessage(crypto, item.params);
      await persist();
    }
    const { ack } = await startCommit(item.prepared, { checkServer: item.attempts > 1 });
    // Don't hold up the rest of the queue waiting for the server: offline, the
    // ack can take a long time and Firestore is already holding the write.
    ack.then(
      () => void remove(item.id),
      (e) => void fail(item, e),
    );
  } catch (e) {
    await fail(item, e);
  } finally {
    running.delete(item.id);
  }
}

/** Retry one failed message right now. */
export async function retry(id: string): Promise<void> {
  await load();
  const item = queue.find((i) => i.id === id);
  if (item) await process(item);
}

/** Give up on a message and drop it. */
export async function discard(id: string): Promise<void> {
  await load();
  await remove(id);
}

/** Try everything that isn't already in flight, oldest first. */
export async function flush(crypto?: SessionManager): Promise<void> {
  if (crypto) engine = crypto;
  await load();
  const due = queue
    .filter((i) => !running.has(i.id) && i.attempts < AUTO_RETRY_LIMIT + (i.state === 'queued' ? 1 : 0))
    .sort((a, b) => a.params.createdAt - b.params.createdAt);
  for (const item of due) await process(item);
}

/** Start flushing on app start, on reconnect, and when the app returns to the foreground. */
export function startOutbox(crypto: SessionManager): () => void {
  engine = crypto;
  const unsubNet = NetInfo.addEventListener((state) => {
    if (state.isConnected) void flush();
  });
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') void flush();
  });
  void flush();
  return () => {
    unsubNet();
    sub.remove();
  };
}

/** Test hook. */
export function resetOutboxForTests(): void {
  queue = [];
  loaded = null;
  engine = null;
  running.clear();
  listeners.clear();
  persistChain = Promise.resolve();
}
