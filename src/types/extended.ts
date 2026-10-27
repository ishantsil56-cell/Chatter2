/**
 * Extended domain types — the restored WhatsApp-parity feature set.
 *
 * Deliberately trimmed: the October parity scaffold also sketched event /
 * sticker / location / contact kinds and broadcast channels. Those are NOT
 * built and are NOT restored here — this file holds only what ships:
 * polls, reactions, and the message feature metadata.
 *
 * Design rules (same as the rest of IRIS):
 * - Message bodies stay end-to-end encrypted. Anything the server must act
 *   on (reaction counts, poll tallies, expiry timers) lives in CLEAR fields
 *   next to the encrypted envelope — never inside it.
 * - Every new message kind reuses `Message.envelopes`; only the *payload
 *   schema* changes. The crypto layer is untouched.
 */

import type { UserId } from '@/types';

/** Plaintext poll payload. Serialised to JSON, then sealed into the
 *  per-recipient envelopes exactly like `text`. */
export interface PollPayload {
  question: string;
  options: string[];
  /** Unix ms when voting closes; null = no deadline. */
  closesAt: number | null;
  /** True = voters can pick several options. */
  multiSelect: boolean;
}

/** A single reaction: who reacted, with what, when. Stored as a subcollection
 *  `chats/{chatId}/messages/{messageId}/reactions/{uid}` so counts update live
 *  and no message rewrite is needed. The emoji itself is NOT secret. */
export interface Reaction {
  uid: UserId;
  emoji: string;
  createdAt: number;
}

/** Vote on a poll option. Subcollection
 *  `chats/{chatId}/messages/{messageId}/votes/{uid}`. */
export interface PollVote {
  uid: UserId;
  optionIndexes: number[];
  createdAt: number;
}

/** Message-level metadata added by the restored features. These live on the
 *  Firestore message document in the clear. */
export interface MessageFeatureMeta {
  /** Set when the sender edits; clients render "Edited". */
  editedAt?: number | null;
  /** Per-chat disappearing-message timer captured at send time (ms). */
  ephemeralTtlMs?: number | null;
  /** Unix ms when clients should hide this message. */
  expiresAt?: number | null;
}
