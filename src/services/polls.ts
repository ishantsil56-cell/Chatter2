/**
 * Polls.
 *
 * WhatsApp behaviour we're matching:
 * - Create: question + 2..12 options, optional multi-select, optional deadline.
 * - Vote: one write per voter (`votes/{uid}`), changeable until close.
 * - Tally is cleartext (counts aren't secret); the question/options travel in
 *   the E2E envelope like any other message body.
 * - Polls are just messages with `kind: 'poll'` whose decrypted JSON parses as
 *   `PollPayload` (see @/types/extended).
 *
 * Firestore layout:
 *   chats/{chatId}/messages/{messageId}            →  kind 'poll', envelopes{…}
 *   chats/{chatId}/messages/{messageId}/votes/{uid} → { optionIndexes, createdAt }
 */

import { db } from './firebase';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { scope } from '@/utils/logger';
import type { ChatId, MessageId, UserId } from '@/types';
import type { PollPayload, PollVote } from '@/types/extended';

const log = scope('polls');

const MAX_OPTIONS = 12;
const MIN_OPTIONS = 2;

export function validatePoll(poll: PollPayload): string | null {
  const question = poll.question.trim();
  if (!question) return 'A poll needs a question.';
  const options = poll.options.map((o) => o.trim()).filter(Boolean);
  if (options.length < MIN_OPTIONS) return 'Add at least two options.';
  if (options.length > MAX_OPTIONS) return `At most ${MAX_OPTIONS} options.`;
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
    return 'Options must be different from each other.';
  }
  if (poll.closesAt != null && poll.closesAt <= Date.now()) {
    return 'The deadline must be in the future.';
  }
  return null;
}

function votesRef(chatId: ChatId, messageId: MessageId) {
  return db
    .collection('chats')
    .doc(chatId)
    .collection('messages')
    .doc(messageId)
    .collection('votes');
}

/** Live votes for one poll message. */
export function subscribeVotes(
  chatId: ChatId,
  messageId: MessageId,
  cb: (votes: PollVote[]) => void,
  onError?: (e: Error) => void,
): () => void {
  return votesRef(chatId, messageId).onSnapshot(
    (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
      if (!snap) return;
      cb(
        snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => ({
          uid: d.id,
          ...(d.data() as Omit<PollVote, 'uid'>),
        })),
      );
    },
    (e: Error) => {
      log('subscribeVotes failed', e);
      onError?.(e);
    },
  );
}

/** Cast (or change) a vote. Overwrites the voter's previous ballot. */
export async function vote(
  chatId: ChatId,
  messageId: MessageId,
  uid: UserId,
  optionIndexes: number[],
  poll: PollPayload,
): Promise<void> {
  if (poll.closesAt != null && Date.now() > poll.closesAt) {
    throw new Error('This poll is closed.');
  }
  const clean = [...new Set(optionIndexes)].filter(
    (i) => Number.isInteger(i) && i >= 0 && i < poll.options.length,
  );
  if (clean.length === 0) throw new Error('Pick at least one option.');
  if (!poll.multiSelect && clean.length > 1) {
    throw new Error('This poll allows only one choice.');
  }
  await votesRef(chatId, messageId)
    .doc(uid)
    .set({ optionIndexes: clean, createdAt: Date.now() } satisfies Omit<PollVote, 'uid'>);
}

/** Remove your vote entirely. */
export async function retractVote(
  chatId: ChatId,
  messageId: MessageId,
  uid: UserId,
): Promise<void> {
  await votesRef(chatId, messageId).doc(uid).delete();
}

/** Tally votes into per-option counts + total ballots. */
export function tallyVotes(
  poll: PollPayload,
  votes: PollVote[],
): { counts: number[]; totalBallots: number } {
  const counts = new Array(poll.options.length).fill(0) as number[];
  for (const v of votes) {
    for (const i of v.optionIndexes) {
      if (i >= 0 && i < counts.length) counts[i] += 1;
    }
  }
  return { counts, totalBallots: votes.length };
}

/** Serialise a poll into the message body IRIS encrypts (JSON → envelope). */
export function encodePollBody(poll: PollPayload): string {
  return JSON.stringify({ v: 1, type: 'poll', ...poll });
}

/** Parse a decrypted body back into a poll, or null if it isn't one. */
export function decodePollBody(text: string | null): PollPayload | null {
  if (!text) return null;
  try {
    const obj = JSON.parse(text) as { v?: number; type?: string } & Partial<PollPayload>;
    if (obj?.type !== 'poll' || typeof obj.question !== 'string' || !Array.isArray(obj.options)) {
      return null;
    }
    return {
      question: obj.question,
      options: obj.options.filter((o): o is string => typeof o === 'string'),
      closesAt: typeof obj.closesAt === 'number' ? obj.closesAt : null,
      multiSelect: obj.multiSelect === true,
    };
  } catch {
    return null;
  }
}
