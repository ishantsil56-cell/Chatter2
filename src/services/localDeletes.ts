/**
 * "Delete for me" — local-only message hiding.
 *
 * The previous implementation hard-deleted the shared Firestore document, which
 * was wrong twice over: it removed the message for *everyone* in the chat, and
 * it failed with permission-denied whenever the message wasn't yours (only the
 * sender may delete the document). Deleting for me must never touch the server
 * copy, so this keeps a per-device set of hidden message IDs in AsyncStorage
 * and the chat screen filters them out when rendering.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { scope } from '@/utils/logger';
import type { ChatId, MessageId } from '@/types';

const log = scope('localDeletes');
const STORAGE_KEY = 'iris.localDeletes.v1';

const key = (chatId: ChatId, messageId: MessageId): string => `${chatId}:${messageId}`;

/** In-memory mirror; populated by loadLocalDeletes() at startup. */
const hidden = new Set<string>();
let loaded = false;

/** Load the persisted set. Safe to call repeatedly; runs once. */
export async function loadLocalDeletes(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const k of arr) if (typeof k === 'string') hidden.add(k);
      }
    }
  } catch (e) {
    log.warn('could not load locally-deleted messages', e);
  }
}

async function persist(): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...hidden]));
  } catch (e) {
    log.warn('could not persist locally-deleted messages', e);
  }
}

/** Synchronous check for render paths (reads the in-memory mirror). */
export function isDeletedLocally(chatId: ChatId, messageId: MessageId): boolean {
  return hidden.has(key(chatId, messageId));
}

/** Hide a message on this device only. Never touches Firestore. */
export async function markDeletedLocally(chatId: ChatId, messageId: MessageId): Promise<void> {
  hidden.add(key(chatId, messageId));
  await persist();
}
