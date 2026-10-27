/**
 * Message reactions.
 *
 * WhatsApp behaviour we're matching:
 * - Long-press a message → quick emoji tray + full picker.
 * - One reaction per user per message; tapping the same emoji again removes it.
 * - Counts update live for everyone via a subcollection (no message rewrite,
 *   so the E2E envelope is never touched).
 *
 * Firestore layout:
 *   chats/{chatId}/messages/{messageId}/reactions/{uid}  →  { emoji, createdAt }
 */

import { db } from './firebase';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { scope } from '@/utils/logger';
import type { ChatId, MessageId, UserId } from '@/types';
import type { Reaction } from '@/types/extended';

const log = scope('reactions');

const CHATS = 'chats';
const MESSAGES = 'messages';
const REACTIONS = 'reactions';

/** WhatsApp's default quick-reaction tray. */
export const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🙏', '👍'] as const;

function reactionsRef(chatId: ChatId, messageId: MessageId) {
  return db
    .collection(CHATS)
    .doc(chatId)
    .collection(MESSAGES)
    .doc(messageId)
    .collection(REACTIONS);
}

/** Live reaction feed for one message. */
export function subscribeReactions(
  chatId: ChatId,
  messageId: MessageId,
  cb: (reactions: Reaction[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return reactionsRef(chatId, messageId).onSnapshot(
    (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      if (!snap) return;
      cb(
        snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({
          uid: d.id,
          ...(d.data() as Omit<Reaction, 'uid'>),
        })),
      );
    },
    (e: Error) => {
      log.warn('subscribeReactions failed', e);
      onError?.(e);
    },
  );
}

/**
 * Toggle a reaction. Same emoji twice removes it; a different emoji replaces
 * the previous one. One write per toggle — no read needed.
 */
export async function toggleReaction(
  chatId: ChatId,
  messageId: MessageId,
  uid: UserId,
  emoji: string,
): Promise<void> {
  const ref = reactionsRef(chatId, messageId).doc(uid);
  const existing = await ref.get();
  if (existing.exists && (existing.data()?.emoji as string) === emoji) {
    await ref.delete();
    return;
  }
  await ref.set({ emoji, createdAt: Date.now() } satisfies Omit<Reaction, 'uid'>);
}

/** Group reactions by emoji for the summary row under a bubble. */
export function summarizeReactions(
  reactions: Reaction[],
): { emoji: string; count: number; uids: UserId[]; reactedByMe: boolean }[] {
  const byEmoji = new Map<string, { uids: UserId[] }>();
  for (const r of reactions) {
    const entry = byEmoji.get(r.emoji) ?? { uids: [] };
    entry.uids.push(r.uid);
    byEmoji.set(r.emoji, entry);
  }
  return [...byEmoji.entries()]
    .map(([emoji, { uids }]) => ({
      emoji,
      count: uids.length,
      uids,
    }))
    .sort((a, b) => b.count - a.count)
    .map((s) => ({ ...s, reactedByMe: false }));
}
