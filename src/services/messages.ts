/**
 * Message send / receive.
 *
 * Sending:
 *   1. Make sure we have an E2EE session with every other member (bootstrapping
 *      one from their prekey bundle if not).
 *   2. Encrypt the plaintext once per member -> `envelopes`.
 *   3. Write the message document. The server only ever sees ciphertext.
 *   4. Cache our own plaintext locally so we can render it.
 *
 * Receiving: decrypt our own envelope with the session for the sender.
 */

import { db } from './firebase';
import { randomId } from '@/utils/id';
import { fetchPeerBundle } from './prekeys';
import { getUser } from './users';
import { putPlaintext, getPlaintext } from './messageCache';
import type { SessionManager } from './crypto/session';
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
const PAGE_SIZE = 200;

function messagesRef(chatId: ChatId) {
  return db.collection(CHATS).doc(chatId).collection(MESSAGES);
}

/** Live message feed for a chat, oldest first. */
export function subscribeMessages(
  chatId: ChatId,
  cb: (messages: Message[]) => void,
  limit = PAGE_SIZE,
): () => void {
  return messagesRef(chatId)
    .orderBy('createdAt', 'asc')
    .limitToLast(limit)
    .onSnapshot(
      (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Message)),
      (err) => log.error('subscribeMessages failed', err),
    );
}

// --- Identity-key cache (needed to decrypt, and for safety numbers) -----------

const identityKeyCache = new Map<UserId, string>();

export async function getPeerIdentityKey(uid: UserId): Promise<string> {
  const cached = identityKeyCache.get(uid);
  if (cached) return cached;
  const profile = await getUser(uid);
  if (!profile) throw new Error(`cannot resolve identity key for ${uid}`);
  identityKeyCache.set(uid, profile.identityKey);
  return profile.identityKey;
}

export function primeIdentityKey(uid: UserId, key: string): void {
  identityKeyCache.set(uid, key);
}

// --- Sending ------------------------------------------------------------------

export interface SendParams {
  chatId: ChatId;
  senderId: UserId;
  memberIds: UserId[];
  kind: MessageKind;
  text?: string;
  media?: MediaDescriptor | null;
}

/** Establish sessions with any members we don't have one for yet. */
async function ensureSessions(crypto: SessionManager, senderId: UserId, memberIds: UserId[]): Promise<void> {
  for (const memberId of memberIds) {
    if (memberId === senderId) continue;
    if (crypto.hasSession(memberId)) continue;
    const { bundle, identityKey } = await fetchPeerBundle(memberId);
    primeIdentityKey(memberId, identityKey);
    await crypto.createOutboundSession(memberId, bundle);
  }
}

export interface SendResult {
  messageId: MessageId;
  clientId: string;
  local: DecryptedMessage;
}

export async function sendMessage(crypto: SessionManager, params: SendParams): Promise<SendResult> {
  const { chatId, senderId, memberIds, kind, text = '', media = null } = params;
  const recipients = memberIds.filter((m) => m !== senderId);

  await ensureSessions(crypto, senderId, memberIds);

  // Encrypt once per recipient.
  const envelopes: Record<UserId, CipherEnvelope> = {};
  for (const recipient of recipients) {
    const payload = await crypto.encrypt(recipient, text);
    envelopes[recipient] = { ciphertext: payload.ciphertext, header: payload.header };
  }

  const now = Date.now();
  const clientId = randomId(8);
  const receipts: Record<UserId, Message['receipts'][string]> = Object.fromEntries(
    memberIds.map((m) => [m, m === senderId ? 'sent' : 'sent']),
  );

  const doc: Omit<Message, 'id'> = {
    chatId,
    senderId,
    kind,
    envelopes,
    media,
    systemText: null,
    createdAt: now,
    receipts,
    clientId,
  };

  const ref = await messagesRef(chatId).add(doc);
  await putPlaintext(ref.id, text);

  // Update the denormalised preview.
  const preview = previewFor(kind, text);
  await db.collection(CHATS).doc(chatId).set(
    { lastMessageAt: now, lastMessagePreview: preview, updatedAt: now },
    { merge: true },
  );

  const local: DecryptedMessage = {
    id: ref.id,
    ...doc,
    text,
    decrypted: true,
    pending: false,
  };
  return { messageId: ref.id, clientId, local };
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

function previewFor(kind: MessageKind, text: string): string {
  switch (kind) {
    case 'image':
      return 'Photo';
    case 'voice':
      return 'Voice message';
    case 'file':
      return 'Document';
    default:
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  }
}

// --- Receiving / decrypting ---------------------------------------------------

export async function decryptMessage(
  crypto: SessionManager,
  message: Message,
  myUid: UserId,
): Promise<DecryptedMessage> {
  // System messages are plain by design.
  if (message.kind === 'system') {
    return { ...message, text: message.systemText ?? null, decrypted: true };
  }

  // Our own sent message — read the locally cached plaintext.
  if (message.senderId === myUid) {
    const text = (await getPlaintext(message.id)) ?? '';
    return { ...message, text, decrypted: text !== '' };
  }

  const envelope = message.envelopes?.[myUid];
  if (!envelope) {
    return { ...message, text: null, decrypted: false };
  }

  try {
    const senderIdentityKey = await getPeerIdentityKey(message.senderId);
    const text = await crypto.decrypt(message.senderId, senderIdentityKey, envelope);
    return { ...message, text, decrypted: true };
  } catch (e) {
    log.warn(`could not decrypt message ${message.id}: ${(e as Error).message}`);
    return { ...message, text: null, decrypted: false };
  }
}

export async function decryptAll(
  crypto: SessionManager,
  messages: Message[],
  myUid: UserId,
): Promise<DecryptedMessage[]> {
  // Decryption mutates ratchet state, so it must run sequentially in order.
  const out: DecryptedMessage[] = [];
  for (const m of messages) {
    out.push(await decryptMessage(crypto, m, myUid));
  }
  return out;
}

// --- Receipts -----------------------------------------------------------------

export async function markDelivered(chatId: ChatId, messageId: MessageId, uid: UserId): Promise<void> {
  await messagesRef(chatId)
    .doc(messageId)
    .set({ [`receipts.${uid}`]: 'delivered' }, { merge: true });
}

/**
 * Acknowledge everything from other people in this chat as delivered.
 *
 * This runs when OUR app receives a message — not when we open the chat — so
 * the sender's tick turns into two checks as soon as the message reaches our
 * device, which is what a "delivered" tick is meant to mean.
 */
export async function ackUndelivered(chatId: ChatId, uid: UserId, limit = 25): Promise<void> {
  const snap = await messagesRef(chatId).orderBy('createdAt', 'desc').limit(limit).get();
  const pending = snap.docs.filter((d) => {
    const m = d.data() as Message;
    return m.senderId !== uid && m.receipts?.[uid] === 'sent';
  });
  await Promise.all(pending.map((d) => markDelivered(chatId, d.id, uid)));
}

export async function markRead(chatId: ChatId, messageId: MessageId, uid: UserId): Promise<void> {
  await messagesRef(chatId)
    .doc(messageId)
    .set({ [`receipts.${uid}`]: 'read' }, { merge: true });
}

export async function deleteMessage(chatId: ChatId, messageId: MessageId): Promise<void> {
  await messagesRef(chatId).doc(messageId).delete();
}
