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
  | 'contact'
  | 'call_log';

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

export interface CallLogPayload {
  kind: 'voice' | 'video';
  direction: 'incoming' | 'outgoing' | 'missed';
  durationMs: number;
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

/** A Story (Status) — ephemeral 24h broadcast to chosen audience. */
export interface Story {
  id: string;
  ownerId: UserId;
  kind: 'image' | 'video' | 'text';
  /** Encrypted media descriptor (dimensions/mime cleartext, bytes encrypted). */
  media?: MediaDescriptor | null;
  /** Audience: 'contacts' | 'close_friends' | 'except' | 'only'. */
  audience: StoryAudience;
  audienceExcept?: UserId[];
  audienceOnly?: UserId[];
  createdAt: number;
  expiresAt: number;
  /**
   * Per-viewer sealed payloads, keyed by viewer uid — same envelope scheme as
   * Message.envelopes. The JSON inside is a StoryPayload
   * { text?, mediaKey?, backgroundColor?, fontStyle?, caption? }.
   */
  envelopes: Record<UserId, { ciphertext: string; header: unknown }>;
  /** Owner's own copy, sealed with their history key (like Message.selfEnvelope). */
  selfEnvelope?: { nonce: string; ciphertext: string } | null;
  /** Uids that viewed — written by viewers, readable by owner. */
  views?: Record<UserId, number>;
  /** Uids that liked. */
  likes?: Record<UserId, number>;
}

/** The plaintext inside a story envelope. Never leaves the client unsealed. */
export interface StoryPayload {
  kind: 'image' | 'video' | 'text';
  /** Text story content, or caption for media stories. */
  text?: string;
  /** base64 media key for downloadAndDecrypt (media stories). */
  mediaKey?: string;
  backgroundColor?: string;
  fontStyle?: string;
}

export type StoryAudience = 'contacts' | 'close_friends' | 'except' | 'only';

/** A voice/video call session. Signalling goes over Firestore; media over a
 *  managed SFU (see services/calls.ts). */
export type CallKind = 'voice' | 'video';
export type CallState =
  | 'ringing'
  | 'active'
  | 'ended'
  | 'declined'
  | 'missed'
  | 'busy';

export interface CallSession {
  id: string;
  chatId: ChatId;
  kind: CallKind;
  state: CallState;
  initiatorId: UserId;
  participantIds: UserId[];
  startedAt: number;
  endedAt: number | null;
  /** SFU room token — opaque to Firestore, minted by the call backend. */
  roomToken?: string | null;
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
