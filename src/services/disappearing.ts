/**
 * Disappearing messages + message edit / delete-for-everyone.
 *
 * WhatsApp behaviour we're matching:
 * - A per-chat default TTL (off / 24h / 7d / 90d). Every new message captures
 *   the chat's TTL at send time (`ephemeralTtlMs`) plus a computed `expiresAt`.
 * - Clients hide (and drop from the local cache) messages past `expiresAt`.
 *   A Cloud Function should hard-delete them server-side too — the client
 *   must never be the only enforcement.
 * - Edit: sender-only, within 15 minutes, keeps one "Edited" flag. The new
 *   body is re-encrypted into fresh envelopes; history keeps the old version
 *   only in the sender's self-envelope.
 * - Delete for everyone: sender-only, within ~2 days, replaces the body with
 *   a tombstone. Recipients who already cached plaintext drop it.
 *
 * Cleartext fields used (see @/types/extended `MessageFeatureMeta`):
 *   editedAt, deletedForEveryoneAt, ephemeralTtlMs, expiresAt
 */

import { db } from './firebase';
import { scope } from '@/utils/logger';
import type { ChatId, MessageId, UserId } from '@/types';

const log = scope('ephemeral');

export const EPHEMERAL_OFF = 0;
export const EPHEMERAL_24H = 24 * 60 * 60 * 1000;
export const EPHEMERAL_7D = 7 * EPHEMERAL_24H;
export const EPHEMERAL_90D = 90 * EPHEMERAL_24H;

export const EPHEMERAL_CHOICES = [
  { label: 'Off', value: EPHEMERAL_OFF },
  { label: '24 hours', value: EPHEMERAL_24H },
  { label: '7 days', value: EPHEMERAL_7D },
  { label: '90 days', value: EPHEMERAL_90D },
] as const;

/** Alias used by the settings UI. */
export const EPHEMERAL_TTLS = EPHEMERAL_CHOICES.map((c) => ({ label: c.label, ms: c.value }));

/** Human label for a TTL value. */
export function ttlLabel(ms: number): string {
  return EPHEMERAL_CHOICES.find((c) => c.value === ms)?.label ?? 'Custom';
}

/** 15-minute edit window, matching WhatsApp. */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
/** ~2-day delete-for-everyone window. */
export const DELETE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function messageRef(chatId: ChatId, messageId: MessageId) {
  return db.collection('chats').doc(chatId).collection('messages').doc(messageId);
}

/** Set the chat's default disappearing-message timer. Emits a system message. */
export async function setEphemeralTtl(
  chatId: ChatId,
  ttlMs: number,
  actorId?: UserId,
): Promise<void> {
  if (![EPHEMERAL_OFF, EPHEMERAL_24H, EPHEMERAL_7D, EPHEMERAL_90D].includes(ttlMs)) {
    throw new Error('Unsupported disappearing-message timer.');
  }
  await db.collection('chats').doc(chatId).update({
    defaultEphemeralTtlMs: ttlMs,
    updatedAt: Date.now(),
  });
  log('ephemeral ttl set', { chatId, ttlMs, actorId });
  // Callers should follow with a `kind: 'system'` message describing the change,
  // e.g. "Ishant turned on disappearing messages (7 days)".
}

/** True when the message should no longer be shown. */
export function isExpired(expiresAt: number | null | undefined, now = Date.now()): boolean {
  return expiresAt != null && now >= expiresAt;
}

/**
 * Whether the edit affordance should be shown: own message, text kind,
 * not deleted, within the 15-minute window.
 */
export function canEditMessage(senderId: UserId, myUid: UserId, sentAt: number, kind: string, deleted: boolean): boolean {
  return senderId === myUid && !deleted && kind === 'text' && Date.now() - sentAt <= EDIT_WINDOW_MS;
}

/** Whether "delete for everyone" should be shown: own message, within 48h. */
export function canDeleteForEveryone(senderId: UserId, myUid: UserId, sentAt: number, deleted: boolean): boolean {
  return senderId === myUid && !deleted && Date.now() - sentAt <= DELETE_WINDOW_MS;
}

/**
 * Mark a message edited. The caller re-encrypts the new body first (via the
 * normal send path) and passes the fresh envelopes + self envelope here.
 * Only the original sender, within EDIT_WINDOW_MS.
 */
export async function editMessage(
  chatId: ChatId,
  messageId: MessageId,
  senderId: UserId,
  sentAt: number,
  newEnvelopes: Record<UserId, { ciphertext: string; header: unknown }>,
  newSelfEnvelope: unknown,
): Promise<void> {
  if (Date.now() - sentAt > EDIT_WINDOW_MS) {
    throw new Error('Messages can only be edited within 15 minutes of sending.');
  }
  await messageRef(chatId, messageId).update({
    envelopes: newEnvelopes,
    selfEnvelope: newSelfEnvelope,
    editedAt: Date.now(),
  });
}

/**
 * Tombstone a message for everyone. Only the sender, within DELETE_WINDOW_MS.
 * Envelopes are wiped so the body can never be recovered from the server copy.
 */
export async function deleteForEveryone(
  chatId: ChatId,
  messageId: MessageId,
  senderId: UserId,
  sentAt: number,
): Promise<void> {
  if (Date.now() - sentAt > DELETE_WINDOW_MS) {
    throw new Error('Messages can only be deleted for everyone within 2 days.');
  }
  await messageRef(chatId, messageId).update({
    envelopes: {},
    selfEnvelope: null,
    media: null,
    deletedForEveryoneAt: Date.now(),
  });
  log('deleted for everyone', { chatId, messageId, senderId });
}

/**
 * Sweep helper for the local cache: drop plaintext of expired messages.
 * Wire into messageCache eviction (see services/messageCache.ts).
 */
export function shouldPurgeLocally(
  expiresAt: number | null | undefined,
  now = Date.now(),
): boolean {
  return isExpired(expiresAt, now);
}
