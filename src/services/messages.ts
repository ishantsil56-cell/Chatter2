/**
 * Message send / receive.
 *
 * Sending is split in two so it can survive bad networks:
 *   prepareMessage — make sure we have a session with every member, encrypt once
 *                    per recipient (+ a self-copy for history), and build the
 *                    Firestore document. Needs the network only to fetch keys.
 *   commitMessage  — write the document. Uses a client-chosen document id so a
 *                    retry can never create a duplicate. Firestore queues the
 *                    write offline and syncs it when the connection returns.
 *
 * Receiving: each message is decrypted exactly once and its plaintext cached
 * (see ./messageCache.ts), because the ratchet key for it is spent afterwards.
 */

import { db } from './firebase';
import { randomId } from '@/utils/id';
import { fetchPeerBundle, fetchPeerIdentityKey } from './prekeys';
import { getUser } from './users';
import { putPlaintext, getPlaintext } from './messageCache';
import { sealForSelf, openSelfEnvelope } from './historyKey';
import { cryptoErrorCode, type SessionManager } from './crypto/session';
import { truncate } from '@/utils/text';
import type {
  ChatId,
  CipherEnvelope,
  DecryptedMessage,
  Message,
  MessageId,
  MessageKind,
  MediaDescriptor,
  UserId,
} from '@/types';
import { scope } from '@/utils/logger';

const log = scope('messages');

const CHATS = 'chats';
const MESSAGES = 'messages';
export const PAGE_SIZE = 50;
const IDENTITY_TTL_MS = 2 * 60 * 1000;

function messagesRef(chatId: ChatId) {
  return db.collection(CHATS).doc(chatId).collection(MESSAGES);
}

/** A message as delivered by Firestore, plus whether our own write is still unconfirmed. */
export type RawMessage = Message & { pendingWrite?: boolean };

export interface FeedInfo {
  /** True when the page is full, i.e. there are probably older messages. */
  hasMore: boolean;
}

/** Live message feed for a chat, oldest first, limited to the most recent `limit`. */
export function subscribeMessages(
  chatId: ChatId,
  cb: (messages: RawMessage[], info: FeedInfo) => void,
  limit = PAGE_SIZE,
  onError?: (e: Error) => void,
): () => void {
  return messagesRef(chatId)
    .orderBy('createdAt', 'asc')
    .limitToLast(limit)
    .onSnapshot(
      { includeMetadataChanges: true },
      (snap) =>
        cb(
          snap.docs.map((d) => ({ id: d.id, ...d.data(), pendingWrite: d.metadata.hasPendingWrites }) as RawMessage),
          { hasMore: snap.docs.length >= limit },
        ),
      (err) => {
        log.error('subscribeMessages failed', err);
        onError?.(err);
      },
    );
}

// --- Identity-key cache (needed to decrypt, and for safety numbers) -----------

const identityKeyCache = new Map<UserId, { key: string; at: number }>();

export async function getPeerIdentityKey(uid: UserId): Promise<string> {
  const cached = identityKeyCache.get(uid);
  if (cached) return cached.key;
  const profile = await getUser(uid);
  if (!profile) throw new Error(`cannot resolve identity key for ${uid}`);
  identityKeyCache.set(uid, { key: profile.identityKey, at: Date.now() });
  return profile.identityKey;
}

export function primeIdentityKey(uid: UserId, key: string): void {
  identityKeyCache.set(uid, { key, at: Date.now() });
}

/** Re-read a peer's identity key from the server (they may have reinstalled). */
export async function refreshPeerIdentityKey(uid: UserId): Promise<string | null> {
  const key = await fetchPeerIdentityKey(uid);
  if (key) primeIdentityKey(uid, key);
  return key;
}

async function currentIdentityKey(uid: UserId): Promise<string | null> {
  const cached = identityKeyCache.get(uid);
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.key;
  return refreshPeerIdentityKey(uid);
}

export function resetMessageCachesForTests(): void {
  identityKeyCache.clear();
  inflight.clear();
}

// --- Sending ------------------------------------------------------------------

export interface SendParams {
  chatId: ChatId;
  senderId: UserId;
  memberIds: UserId[];
  kind: MessageKind;
  text?: string;
  media?: MediaDescriptor | null;
  /** Stable id for this message (also its Firestore document id). Generated if absent. */
  clientId?: string;
  /** When the user hit send. Generated if absent. */
  createdAt?: number;
}

export interface PreparedMessage {
  chatId: ChatId;
  docId: MessageId;
  doc: Omit<Message, 'id'>;
  text: string;
  /** Recipients we couldn't reach (no keys yet) — they won't get this message. */
  skipped: UserId[];
}

/**
 * Make sure we have a *current* session with every recipient. A session built
 * against an old identity key (the peer reinstalled) is replaced. Recipients we
 * can't reach are skipped; the send only fails if NONE can be reached.
 */
export async function ensureSessions(
  crypto: SessionManager,
  senderId: UserId,
  memberIds: UserId[],
  opts: { withoutOneTimePreKey?: boolean } = {},
): Promise<{ reachable: UserId[]; skipped: UserId[] }> {
  const reachable: UserId[] = [];
  const skipped: UserId[] = [];
  let lastError: unknown = null;

  for (const memberId of memberIds) {
    if (memberId === senderId) continue;
    try {
      const sessionKey = crypto.sessionPeerIdentityKey(memberId);
      const current = sessionKey ? await currentIdentityKey(memberId) : null;
      const stale = !!sessionKey && !!current && sessionKey !== current;
      if (sessionKey && !stale) {
        reachable.push(memberId);
        continue;
      }
      const { bundle, identityKey } = await fetchPeerBundle(memberId, opts);
      primeIdentityKey(memberId, identityKey);
      await crypto.createOutboundSession(memberId, bundle, { replace: stale });
      reachable.push(memberId);
    } catch (e) {
      lastError = e;
      skipped.push(memberId);
      log.warn(`could not set up a session with ${memberId}`, e);
    }
  }
  if (reachable.length === 0 && skipped.length > 0) throw lastError;
  return { reachable, skipped };
}

export async function prepareMessage(crypto: SessionManager, params: SendParams): Promise<PreparedMessage> {
  const { chatId, senderId, memberIds, kind, text = '', media = null } = params;
  const clientId = params.clientId ?? randomId(16);
  const createdAt = params.createdAt ?? Date.now();

  const { reachable, skipped } = await ensureSessions(crypto, senderId, memberIds);

  const envelopes: Record<UserId, CipherEnvelope> = {};
  for (const recipient of reachable) {
    const payload = await crypto.encrypt(recipient, text);
    envelopes[recipient] = { ciphertext: payload.ciphertext, header: payload.header };
  }

  let selfEnvelope = null;
  try {
    selfEnvelope = await sealForSelf(senderId, text);
  } catch (e) {
    log.warn('could not seal a history copy', e);
  }

  const doc: Omit<Message, 'id'> = {
    chatId,
    senderId,
    kind,
    envelopes,
    selfEnvelope,
    media,
    systemText: null,
    createdAt,
    receipts: Object.fromEntries(memberIds.map((m) => [m, 'sent' as const])),
    clientId,
  };
  return { chatId, docId: clientId, doc, text, skipped };
}

/**
 * Start writing a prepared message. Resolves as soon as the write has been
 * handed to Firestore (it is then queued durably, even offline); `ack` settles
 * when the SERVER has accepted or rejected it. Safe to call again for the same
 * message: it won't create a duplicate or reset receipts.
 */
export async function startCommit(
  p: PreparedMessage,
  opts: { checkServer?: boolean } = {},
): Promise<{ ack: Promise<void> }> {
  // Our own plaintext first, so our copy is readable even if the write is slow.
  await putPlaintext(p.docId, p.text);

  const ref = messagesRef(p.chatId).doc(p.docId);
  // On a retry, ask the server too: the first attempt may have landed even though its ack was lost.
  const known = await (opts.checkServer ? ref.get() : ref.get({ source: 'cache' })).catch(() => null);
  if (known?.exists) return { ack: Promise.resolve() };

  const ack = ref.set(p.doc);
  ack.catch(() => undefined); // surfaced by the caller; avoid an unhandled-rejection warning here
  void db
    .collection(CHATS)
    .doc(p.chatId)
    .set(
      {
        lastMessageAt: p.doc.createdAt,
        lastMessagePreview: previewFor(p.doc.kind),
        lastMessageId: p.docId,
        updatedAt: p.doc.createdAt,
      },
      { merge: true },
    )
    .catch((e) => log.warn('could not update chat preview', e));
  return { ack };
}

/** Write a prepared message and wait for the server. */
export async function commitMessage(p: PreparedMessage): Promise<void> {
  const { ack } = await startCommit(p);
  await ack;
}

export interface SendResult {
  messageId: MessageId;
  skipped: UserId[];
}

/** Prepare and write in one step (waits for the server). */
export async function sendMessage(crypto: SessionManager, params: SendParams): Promise<SendResult> {
  const prepared = await prepareMessage(crypto, params);
  await commitMessage(prepared);
  return { messageId: prepared.docId, skipped: prepared.skipped };
}

/** Send media (image / voice / file). The bytes are uploaded separately. */
export async function sendMediaMessage(
  crypto: SessionManager,
  params: Omit<SendParams, 'kind' | 'text'> & { kind: 'image' | 'voice' | 'file'; caption?: string; media: MediaDescriptor },
): Promise<SendResult> {
  return sendMessage(crypto, {
    chatId: params.chatId,
    senderId: params.senderId,
    memberIds: params.memberIds,
    kind: params.kind,
    text: params.caption ?? '',
    media: params.media,
  });
}

/**
 * What the SERVER sees in the chat list. Never the text itself — the list shows
 * the real text from the on-device cache instead (see ChatListItem).
 */
export function previewFor(kind: MessageKind): string {
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'voice':
      return 'Voice message';
    case 'file':
      return 'Document';
    default:
      return 'Message';
  }
}

/** One-line local preview for the chat list from decrypted text. */
export function previewText(kind: MessageKind, text: string): string {
  return kind === 'text' ? truncate(text.replace(/\s+/g, ' ').trim(), 80) : previewFor(kind);
}

// --- Receiving / decrypting ---------------------------------------------------

const inflight = new Map<MessageId, Promise<DecryptedMessage>>();

/**
 * Decrypt one message, at most once at a time per message id (the live feed and
 * the background sync can both ask). Plaintext is cached on success, so repeat
 * calls are free and never touch the ratchet again.
 */
export function decryptMessage(crypto: SessionManager, message: Message, myUid: UserId): Promise<DecryptedMessage> {
  const running = inflight.get(message.id);
  if (running) return running;
  const p = decryptMessageNow(crypto, message, myUid).finally(() => inflight.delete(message.id));
  inflight.set(message.id, p);
  return p;
}

async function decryptMessageNow(crypto: SessionManager, message: Message, myUid: UserId): Promise<DecryptedMessage> {
  // System messages are plain by design.
  if (message.kind === 'system') {
    return { ...message, text: message.systemText ?? null, decrypted: true };
  }

  const cached = await getPlaintext(message.id);

  // Our own sent message: the local cache, else the history-key copy.
  if (message.senderId === myUid) {
    if (cached !== undefined) return { ...message, text: cached, decrypted: true };
    if (message.selfEnvelope) {
      try {
        const text = await openSelfEnvelope(myUid, message.selfEnvelope);
        if (text !== null) {
          await putPlaintext(message.id, text);
          return { ...message, text, decrypted: true };
        }
      } catch (e) {
        log.warn(`could not open history copy of ${message.id}`, e);
      }
    }
    return { ...message, text: '', decrypted: false, decryptIssue: 'unavailable' };
  }

  // Someone else's message: already read once?
  if (cached !== undefined) return { ...message, text: cached, decrypted: true };

  const envelope = message.envelopes?.[myUid];
  if (!envelope) return { ...message, text: null, decrypted: false, decryptIssue: 'unavailable' };

  const attempt = async (): Promise<string> =>
    crypto.decrypt(message.senderId, await getPeerIdentityKey(message.senderId), envelope);

  try {
    let text: string;
    try {
      text = await attempt();
    } catch (first) {
      const code = cryptoErrorCode(first);
      // The sender may have reinstalled: re-read their key and try once more.
      if (code === 'bad-message' || code === 'no-session') {
        const before = identityKeyCache.get(message.senderId)?.key;
        const fresh = await refreshPeerIdentityKey(message.senderId);
        if (fresh && fresh !== before) text = await attempt();
        else throw first;
      } else {
        throw first;
      }
    }
    await putPlaintext(message.id, text);
    return { ...message, text, decrypted: true };
  } catch (e) {
    const code = cryptoErrorCode(e);
    log.warn(`could not decrypt message ${message.id}: ${(e as Error).message}`);
    return { ...message, text: null, decrypted: false, decryptIssue: code === 'session-conflict' ? 'conflict' : 'failed' };
  }
}

/** Decrypt in order (decryption mutates ratchet state). */
export async function decryptAll(crypto: SessionManager, messages: Message[], myUid: UserId): Promise<DecryptedMessage[]> {
  const out: DecryptedMessage[] = [];
  for (const m of messages) out.push(await decryptMessage(crypto, m, myUid));
  return out;
}

/** The ciphertext we hold for this user — changes when the sender re-sends. */
export function envelopeSignature(message: Message, myUid: UserId): string {
  return message.envelopes?.[myUid]?.ciphertext ?? '';
}

// --- Receipts -----------------------------------------------------------------
// Receipts only move forward (sent < delivered < read). The security rules enforce
// that on the server; these helpers also skip writes that can't change anything.

async function setReceipt(chatId: ChatId, messageId: MessageId, uid: UserId, status: 'delivered' | 'read'): Promise<void> {
  await messagesRef(chatId)
    .doc(messageId)
    .update({ [`receipts.${uid}`]: status });
}

export async function markDelivered(chatId: ChatId, messageId: MessageId, uid: UserId): Promise<void> {
  await setReceipt(chatId, messageId, uid, 'delivered');
}

export async function markRead(chatId: ChatId, messageId: MessageId, uid: UserId): Promise<void> {
  await setReceipt(chatId, messageId, uid, 'read');
}

/**
 * Acknowledge recent messages from other people as delivered. Runs when OUR app
 * receives a message — not when we open the chat — so the sender's tick turns
 * into two checks as soon as the message reaches our device.
 */
export async function ackUndelivered(chatId: ChatId, uid: UserId, limit = 25): Promise<void> {
  const snap = await messagesRef(chatId).orderBy('createdAt', 'desc').limit(limit).get();
  const pending = snap.docs.filter((d) => {
    const m = d.data() as Message;
    return m.kind !== 'system' && m.senderId !== uid && m.receipts?.[uid] === 'sent';
  });
  await Promise.all(pending.map((d) => markDelivered(chatId, d.id, uid).catch((e) => log.warn('ack failed', e))));
}

/**
 * Read the newest messages of a chat in the background and decrypt them into the
 * cache, so the chat list can show real previews and nothing is lost if the chat
 * is never opened. Safe to call repeatedly.
 */
export async function ingestRecent(crypto: SessionManager, chatId: ChatId, uid: UserId, limit = 30): Promise<void> {
  const snap = await messagesRef(chatId).orderBy('createdAt', 'desc').limit(limit).get();
  const ascending = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Message).reverse();
  for (const m of ascending) {
    if (m.kind === 'system') continue;
    await decryptMessage(crypto, m, uid);
  }
}

/**
 * One pass over the newest messages that both warms the decrypted cache and
 * acknowledges delivery.
 *
 * The background sync used to call ackUndelivered() and ingestRecent()
 * separately, which meant two Firestore queries — roughly 55 document reads —
 * for every single message received. This does the same work in one query, and
 * costs nothing extra for the decrypt step because decryptMessage() caches.
 */
export async function syncRecent(crypto: SessionManager, chatId: ChatId, uid: UserId, limit = 25): Promise<void> {
  const snap = await messagesRef(chatId).orderBy('createdAt', 'desc').limit(limit).get();
  const ascending = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Message).reverse();

  const toAck: string[] = [];
  for (const m of ascending) {
    if (m.kind !== 'system') await decryptMessage(crypto, m, uid);
    if (m.senderId !== uid && m.receipts?.[uid] === 'sent') toAck.push(m.id);
  }

  await Promise.all(toAck.map((id) => markDelivered(chatId, id, uid).catch((e) => log.warn('ack failed', e))));
}

export async function deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void> {
  await messagesRef(chatId).doc(messageId).delete();
}

/** Replace one recipient's envelope on an existing message (used when re-sending). */
export async function replaceEnvelope(
  chatId: ChatId,
  messageId: MessageId,
  recipient: UserId,
  envelope: CipherEnvelope,
): Promise<void> {
  await messagesRef(chatId)
    .doc(messageId)
    .update({ [`envelopes.${recipient}`]: envelope });
}

