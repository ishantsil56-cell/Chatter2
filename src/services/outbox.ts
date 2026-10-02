/**
 * Offline outbox.
 *
 * When the device is offline (or a send fails), the message is queued to disk
 * and flushed automatically once connectivity returns. Queued items hold only
 * plaintext params — the encryption happens at flush time, so the ratchet stays
 * in order.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { sendMessage, type SendParams } from './messages';
import { randomId } from '@/utils/id';
import type { SessionManager } from './crypto/session';
import { scope } from '@/utils/logger';

const log = scope('outbox');
const KEY = 'chatter.outbox.v1';

interface QueuedSend {
  id: string;
  params: SendParams;
  attempts: number;
  lastError?: string;
}

let queue: QueuedSend[] = [];
let loaded = false;

async function load(): Promise<void> {
  if (loaded) return;
  const raw = await AsyncStorage.getItem(KEY);
  queue = raw ? (JSON.parse(raw) as QueuedSend[]) : [];
  loaded = true;
}

async function persist(): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(queue));
}

export async function enqueue(params: SendParams): Promise<string> {
  await load();
  const id = randomId(8);
  queue.push({ id, params, attempts: 0 });
  await persist();
  log.info(`queued message ${id} (${queue.length} in outbox)`);
  return id;
}

export async function pendingCount(): Promise<number> {
  await load();
  return queue.length;
}

export async function flush(crypto: SessionManager): Promise<void> {
  await load();
  if (queue.length === 0) return;

  const remaining: QueuedSend[] = [];
  for (const item of queue) {
    try {
      await sendMessage(crypto, item.params);
    } catch (e) {
      item.attempts += 1;
      item.lastError = (e as Error).message;
      remaining.push(item);
      log.warn(`flush failed for ${item.id} (attempt ${item.attempts}): ${item.lastError}`);
    }
  }
  queue = remaining;
  await persist();
}

/** Start listening for connectivity and flush when we come back online. */
export function startOutbox(crypto: SessionManager): () => void {
  const unsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected) {
      void flush(crypto);
    }
  });
  // Attempt an initial flush.
  void flush(crypto);
  return unsubscribe;
}
