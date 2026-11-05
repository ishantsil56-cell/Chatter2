/**
 * The Ledger.
 *
 * A chat can promote one of its own messages into a permanent record. The record
 * is a *copy*, taken at send time, so it survives the original message being
 * deleted.
 *
 * ── Why a static key and not the ratchet ────────────────────────────────────
 *
 * The first version sealed each entry through the double ratchet, per member,
 * exactly like a message. That is wrong for an archive, and it took reading
 * `ratchet.ts` to see it: the ratchet is an *ordered stream* with a bounded
 * skip window (`MAX_SKIP = 1000`). A message is decrypted seconds after it
 * arrives; a ledger entry is opened arbitrarily later — that is the entire point
 * of keeping it. Record something today in a chat that then sees a thousand
 * messages and the entry can no longer be opened.
 *
 * So each chat gets one random 32-byte ledger key, sealed to each member once
 * through the ratchet, cached on the device forever after. Entries are encrypted
 * with that key directly (XSalsa20-Poly1305, one nonce per entry). No ordering,
 * no skip window, readable today or in three years.
 *
 * The trade-off is honest: a member who leaves keeps the key for what they
 * already had. That is the same trade-off messages already make.
 */

import * as Keychain from 'react-native-keychain';
import { db } from './firebase';
import { randomId } from '@/utils/id';
import { fetchPeerIdentityKey } from './prekeys';
import { ensureSessions } from './messages';
import { sealForSelf, openSelfEnvelope } from './historyKey';
import { b64, fromB64, open as openSealed, seal as sealSealed, KEY_BYTES, randomBytes } from './crypto/primitives';
import { utf8ToBytes, bytesToUtf8 } from '@/utils/bytes';
import { scope } from '@/utils/logger';
import type { SessionManager } from './crypto/session';
import type { ChatId, CipherEnvelope, UserId } from '@/types';

const log = scope('ledger');

/**
 * The trigger, verbatim.
 *
 * Case sensitive on purpose: `!record` and `!RECORD` are ordinary text. It must
 * also be the last thing in the message, because a trigger in the middle of a
 * sentence is a sentence, not an instruction.
 */
export const LEDGER_TRIGGER = '!Record';

const TRIGGER_RE = /(?:^|\s)!Record\s*$/;

export function hasRecordTrigger(text: string): boolean {
  return TRIGGER_RE.test(text);
}

export function stripRecordTrigger(text: string): string {
  return text.replace(TRIGGER_RE, '').trimEnd();
}

/** The text that would be recorded, or null if there is nothing to record. */
export function recordedText(text: string): string | null {
  if (!hasRecordTrigger(text)) return null;
  const body = stripRecordTrigger(text);
  return body.length > 0 ? body : null;
}

export interface LedgerEntry {
  id: string;
  chatId: ChatId;
  senderId: UserId;
  createdAt: number;
  messageId: string;
  /** Base64. Sealed with the chat's ledger key, not with any session. */
  nonce: string;
  ciphertext: string;
}

function ledgerRef(chatId: ChatId) {
  return db.collection('chats').doc(chatId).collection('ledger');
}

function keyRef(chatId: ChatId) {
  return db.collection('chats').doc(chatId).collection('ledgerMeta').doc('key');
}

// --- The per-chat key ---------------------------------------------------------

function keychainService(chatId: ChatId): string {
  return `com.sil.chatter.ledger.${chatId}`;
}

/** A key we have already unwrapped on this device. Survives reinstall of the app
 *  data only if the keychain does, which is the same guarantee as message keys. */
async function loadCachedKey(chatId: ChatId): Promise<Uint8Array | null> {
  try {
    const stored = await Keychain.getGenericPassword({ service: keychainService(chatId) });
    if (!stored) return null;
    return fromB64(stored.password);
  } catch (e) {
    log.warn('could not read the cached ledger key', e);
    return null;
  }
}

async function cacheKey(chatId: ChatId, key: Uint8Array): Promise<void> {
  try {
    await Keychain.setGenericPassword('ledger', b64(key), { service: keychainService(chatId) });
  } catch (e) {
    log.warn('could not cache the ledger key', e);
  }
}

/**
 * The chat's ledger key, creating it if this is the first record.
 *
 * Two members recording for the first time at the same moment can each create a
 * key, and one write wins — leaving the other member's entries sealed with a key
 * nobody else has. It is a narrow race and the alternative (a Firestore
 * transaction) is documented in this codebase as hanging, so it is accepted and
 * noted rather than hidden.
 */
async function ensureLedgerKey(
  crypto: SessionManager,
  chatId: ChatId,
  meId: UserId,
  memberIds: UserId[],
): Promise<Uint8Array | null> {
  const cached = await loadCachedKey(chatId);
  if (cached) return cached;

  const ref = keyRef(chatId);
  const snap = await ref.get().catch(() => null);

  if (snap?.exists) {
    const data = snap.data() as {
      creatorId: UserId;
      envelopes: Record<UserId, CipherEnvelope>;
      selfEnvelope: CipherEnvelope | null;
    };
    try {
      let raw: string | null = null;
      if (data.creatorId === meId) {
        if (data.selfEnvelope) raw = await openSelfEnvelope(meId, data.selfEnvelope);
      } else {
        const envelope = data.envelopes?.[meId];
        if (envelope) {
          const identity = await fetchPeerIdentityKey(data.creatorId);
          raw = await crypto.decrypt(data.creatorId, identity, envelope);
        }
      }
      if (!raw) return null;
      const key = fromB64(raw);
      await cacheKey(chatId, key);
      return key;
    } catch (e) {
      log.warn(`could not open the ledger key for ${chatId}`, e);
      return null;
    }
  }

  // First record in this chat: make the key and seal it to every member.
  const key = randomBytes(KEY_BYTES);
  const encoded = b64(key);
  const { reachable } = await ensureSessions(crypto, meId, memberIds);

  const envelopes: Record<UserId, CipherEnvelope> = {};
  for (const recipient of reachable) {
    if (recipient === meId) continue;
    const payload = await crypto.encrypt(recipient, encoded);
    envelopes[recipient] = { ciphertext: payload.ciphertext, header: payload.header };
  }

  let selfEnvelope: CipherEnvelope | null = null;
  try {
    selfEnvelope = await sealForSelf(meId, encoded);
  } catch (e) {
    log.warn('could not seal the ledger key for ourselves', e);
  }

  await ref.set({ creatorId: meId, envelopes, selfEnvelope });
  await cacheKey(chatId, key);
  return key;
}

// --- Writing and reading ------------------------------------------------------

export interface RecordParams {
  chatId: ChatId;
  senderId: UserId;
  memberIds: UserId[];
  /** The full message text, trigger included. */
  text: string;
  messageId: string;
}

/**
 * Write a ledger entry for a message.
 *
 * Keyed by the message id, so a retry from the outbox overwrites the same entry
 * instead of adding a second one. Never throws: a failed record must not take
 * the message with it.
 */
export async function recordEntry(crypto: SessionManager, params: RecordParams): Promise<void> {
  const body = recordedText(params.text);
  if (!body) return;

  try {
    const key = await ensureLedgerKey(crypto, params.chatId, params.senderId, params.memberIds);
    if (!key) {
      log.warn('no ledger key available; not recording');
      return;
    }
    const sealed = sealSealed(utf8ToBytes(body), key);
    await ledgerRef(params.chatId).doc(params.messageId).set({
      senderId: params.senderId,
      createdAt: Date.now(),
      messageId: params.messageId,
      nonce: b64(sealed.nonce),
      ciphertext: b64(sealed.ciphertext),
    });
  } catch (e) {
    log.warn('could not record a ledger entry', e);
  }
}

/** Raw entries for one chat, newest first. */
export async function fetchEntries(chatId: ChatId, limit = 25): Promise<LedgerEntry[]> {
  const snap = await ledgerRef(chatId).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((doc) => {
    const data = doc.data() as Omit<LedgerEntry, 'id' | 'chatId'>;
    return { ...data, id: doc.id, chatId };
  });
}

/** Open one entry. Returns null when the key is missing or the data is tampered. */
export async function openEntry(
  crypto: SessionManager,
  entry: LedgerEntry,
  myUid: UserId,
): Promise<string | null> {
  try {
    const key = await loadCachedKey(entry.chatId);
    if (!key) return null;
    const plain = openSealed(
      { nonce: fromB64(entry.nonce), ciphertext: fromB64(entry.ciphertext) },
      key,
    );
    if (!plain) return null;
    return bytesToUtf8(plain);
  } catch (e) {
    log.warn(`could not open ledger entry ${entry.id}`, e);
    return null;
  }
}

/** Resolve the key for a chat without recording anything. Used when opening a shelf. */
export async function primeLedgerKey(
  crypto: SessionManager,
  chatId: ChatId,
  meId: UserId,
  memberIds: UserId[],
): Promise<boolean> {
  const key = await ensureLedgerKey(crypto, chatId, meId, memberIds);
  return key !== null;
}

/** Remove an entry. Explicit, and only ever called from the Ledger. */
export async function deleteEntry(chatId: ChatId, entryId: string): Promise<void> {
  await ledgerRef(chatId).doc(entryId).delete();
}
