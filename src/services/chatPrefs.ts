/**
 * Per-user chat preferences: pin, mute, star, mark-unread.
 *
 * These live OUTSIDE the shared chat document, on purpose. The October parity
 * set pinned and archived on the chat doc itself, so one person's pin pinned
 * the chat for everyone. A preference is private to its owner, so it lives at
 * `users/{uid}/chatPrefs/{chatId}` — readable and writable only by that user
 * (see firestore.rules). Nobody can enumerate anyone else's pins, mutes or
 * stars, and marking a chat unread never touches anyone else's read state.
 */

import { db } from './firebase';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { scope } from '@/utils/logger';
import type { ChatId, UserId } from '@/types';

const log = scope('chatPrefs');

export interface ChatPrefs {
  /** Unix ms when pinned; null/undefined = not pinned. */
  pinnedAt?: number | null;
  /** Muted chats still show in the list, but the push worker skips them. */
  muted?: boolean;
  /** Starred chats are the user's own favourites. */
  starred?: boolean;
  /** Mark-as-unread override: forces the unread badge until the chat opens. */
  unread?: boolean;
}

function prefsRef(uid: UserId, chatId: ChatId) {
  return db.collection('users').doc(uid).collection('chatPrefs').doc(chatId);
}

/** Live preference map for one user: chatId -> prefs. */
export function subscribeChatPrefs(
  uid: UserId,
  cb: (prefs: Record<ChatId, ChatPrefs>) => void,
  onError?: (e: Error) => void,
): () => void {
  return db
    .collection('users')
    .doc(uid)
    .collection('chatPrefs')
    .onSnapshot(
      (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
        if (!snap) return;
        const out: Record<ChatId, ChatPrefs> = {};
        for (const d of snap.docs) out[d.id] = d.data() as ChatPrefs;
        cb(out);
      },
      (e: Error) => {
        log.warn('subscribeChatPrefs failed', e);
        onError?.(e);
      },
    );
}

async function setField(uid: UserId, chatId: ChatId, patch: Partial<ChatPrefs>): Promise<void> {
  await prefsRef(uid, chatId).set(patch, { merge: true });
}

export async function setPinned(uid: UserId, chatId: ChatId, pinned: boolean): Promise<void> {
  await setField(uid, chatId, { pinnedAt: pinned ? Date.now() : null });
}

export async function setMuted(uid: UserId, chatId: ChatId, muted: boolean): Promise<void> {
  await setField(uid, chatId, { muted });
}

export async function setStarred(uid: UserId, chatId: ChatId, starred: boolean): Promise<void> {
  await setField(uid, chatId, { starred });
}

export async function markUnread(uid: UserId, chatId: ChatId): Promise<void> {
  await setField(uid, chatId, { unread: true });
}

export async function clearUnread(uid: UserId, chatId: ChatId): Promise<void> {
  await setField(uid, chatId, { unread: false });
}
