/**
 * Extended domain types — WhatsApp-parity feature set for IRIS.
 *
 * These extend the core types in `@/types` (Message, Chat, UserProfile).
 * Drop this file into `src/types/` and re-export from `src/types/index.ts`.
 *
 * Design rules (same as the rest of IRIS):
 * - Message bodies stay end-to-end encrypted. Anything the server must act
 *   on (reaction counts, poll tallies, expiry timers) lives in CLEAR fields
 *   next to the encrypted envelope — never inside it.
 * - Every new message kind reuses `Message.envelopes`; only the *payload
 *   schema* changes. The crypto layer is untouched.
 */

import type { ChatId, MediaDescriptor, MessageId, UserId } from '@/types';

/** Every message kind IRIS will support after the WhatsApp-parity work. */
export type ExtendedMessageKind =
  | 'text'
  | 'image'
  | 'voice'
  | 'file'
  | 'system'
  // --- new ---
  | 'poll'
  | 'event'
  | 'sticker'
  | 'location'
  | 'contact';

/** Plaintext payload shapes, one per new kind. Serialised to JSON, then sealed
 *  into the per-recipient envelopes exactly like `text`. */
export interface PollPayload {
  question: string;
  options: string[];
  /** Unix ms when voting closes; null = no deadline. */
  closesAt: number | null;
  /** True = voters can pick several options. */
  multiSelect: boolean;
}

export interface EventPayload {
  title: string;
  description: string;
  /** Unix ms. */
  startsAt: number;
  endsAt: number | null;
  location: string | null;
  /** Uids that RSVP'd "going". Cleartext so the tally renders without decrypting. */
  rsvps?: Record<UserId, 'going' | 'maybe' | 'declined'>;
}

export interface StickerPayload {
  /** Storage path of the encrypted sticker blob (webp/lottie). */
  storagePath: string;
  nonce: string;
  sha256: string;
  /** Pack this sticker belongs to, for the sticker picker. */
  packId: string;
  animated: boolean;
}

export interface LocationPayload {
  latitude: number;
  longitude: number;
  /** Optional label / address line. */
  name: string | null;
  /** When set, the sender keeps pushing updates until this timestamp. */
  liveUntil: number | null;
}

export interface ContactPayload {
  displayName: string;
  /** vCard 3.0, may carry several phone numbers / emails. */
  vcard: string;
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

/** Message-level metadata added by the new features. These live on the
 *  Firestore message document in the clear. */
export interface MessageFeatureMeta {
  /** Set when the sender edits; clients render "Edited" + history note. */
  editedAt?: number | null;
  /** Tombstone for "delete for everyone". Clients hide the body. */
  deletedForEveryoneAt?: number | null;
  /** Per-chat disappearing-message timer captured at send time (ms). */
  ephemeralTtlMs?: number | null;
  /** Unix ms when clients should hide this message. */
  expiresAt?: number | null;
}

/** Per-chat settings extended for the new features. Merge into `Chat`. */
export interface ChatFeatureSettings {
  /** Default disappearing-message TTL for new messages (ms, 0 = off). */
  defaultEphemeralTtlMs?: number;
  /** Group-only: who may send (everyone | admins). */
  sendPermission?: 'everyone' | 'admins';
  /** Whether reactions are allowed in this chat. */
  reactionsEnabled?: boolean;
}

/** A broadcast channel (WhatsApp "Channels" equivalent). */
export interface Channel {
  id: string;
  name: string;
  description: string;
  photoURL: string | null;
  ownerId: UserId;
  followerIds: UserId[];
  followerCount: number;
  createdAt: number;
}
