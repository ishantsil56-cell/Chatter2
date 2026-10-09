/**
 * Chats: direct and group. A chat document holds membership, denormalised
 * preview data for the list screen, per-member read cursors, and (for groups)
 * admins. Messages live in a subcollection — see ./messages.ts.
 */

import { db } from './firebase';
import { directChatId, randomId } from '@/utils/id';
import type { Chat, ChatId, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('chats');

const CHATS = 'chats';
const MESSAGES = 'messages';
const TYPING = 'typing';

/** Get the deterministic direct-chat id for two users, creating the doc once. */
export async function ensureDirectChat(myUid: UserId, peerUid: UserId): Promise<ChatId> {
  const id = directChatId(myUid, peerUid);
  const ref = db.collection(CHATS).doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    const now = Date.now();
    const chat: Chat = {
      id,
      kind: 'direct',
      name: null,
      photoURL: null,
      memberIds: [myUid, peerUid].sort(),
      lastReadAt: { [myUid]: 0, [peerUid]: 0 },
      lastMessageAt: now,
      lastMessagePreview: '',
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(chat);
    log.info(`created direct chat ${id}`);
  }
  return id;
}

export async function createGroup(
  creatorUid: UserId,
  memberIds: UserId[],
  name: string,
): Promise<ChatId> {
  const id = randomId(12);
  const now = Date.now();
  const members = Array.from(new Set([creatorUid, ...memberIds]));
  const chat: Chat = {
    id,
    kind: 'group',
    name,
    photoURL: null,
    createdBy: creatorUid,
    memberIds: members,
    adminIds: [creatorUid],
    lastReadAt: Object.fromEntries(members.map((m) => [m, 0])),
    lastMessageAt: now,
    lastMessagePreview: '',
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(CHATS).doc(id).set(chat);
  await writeSystemMessage(id, `${name} created`, members);
  log.info(`created group ${id} with ${members.length} members`);
  return id;
}

export async function getChat(chatId: ChatId): Promise<Chat | null> {
  const snap = await db.collection(CHATS).doc(chatId).get();
  return snap.exists ? (snap.data() as Chat) : null;
}

/** Live list of a user's chats, newest activity first. */
export function subscribeChats(uid: UserId, cb: (chats: Chat[]) => void): () => void {
  // NOTE: deliberately no `orderBy` here.
  // Combining `array-contains` with an `orderBy` requires a composite Firestore
  // index. Without that index the whole query FAILS — which meant the recipient
  // saw an empty chat list and never received anything, while the sender (who
  // navigates straight into the chat) saw their message fine. Sorting
  // newest-first in JS needs no index at all.
  return db
    .collection(CHATS)
    .where('memberIds', 'array-contains', uid)
    .onSnapshot(
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Chat);
        list.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
        // Drop chats this member deleted, unless a newer message has arrived
        // since — which is what makes "delete chat" reversible.
        cb(
          list.filter((c) => {
            // Accept both shapes: the nested map this now writes, and the flat
            // "hiddenFor.<uid>" key the earlier `set` version produced, so
            // chats deleted before the fix also stay hidden.
            const flat = (c as unknown as Record<string, number | undefined>)[`hiddenFor.${uid}`];
            const hiddenAt = c.hiddenFor?.[uid] ?? flat;
            return !hiddenAt || (c.lastMessageAt ?? 0) > hiddenAt;
          }),
        );
      },
      (err) => log.error('subscribeChats failed', err),
    );
}

export function subscribeChat(chatId: ChatId, cb: (chat: Chat | null) => void): () => void {
  return db
    .collection(CHATS)
    .doc(chatId)
    .onSnapshot((snap) => cb(snap.exists ? (snap.data() as Chat) : null));
}

/** Denormalised preview so the chat list doesn't need to read messages. */
export async function updateChatPreview(
  chatId: ChatId,
  preview: string,
  at: number,
  messageId?: string,
): Promise<void> {
  await db.collection(CHATS).doc(chatId).set(
    { lastMessageAt: at, lastMessagePreview: preview, lastMessageId: messageId ?? null, updatedAt: at },
    { merge: true },
  );
}

/**
 * Advance a member's read cursor. Cursors never move backwards: pass the value
 * you already know (`current`) and a no-op write is skipped; the security rules
 * reject a regression from any other client too.
 */
export async function setLastRead(chatId: ChatId, uid: UserId, at: number, current = 0): Promise<boolean> {
  if (at <= current) return false;
  await db.collection(CHATS).doc(chatId).update({ [`lastReadAt.${uid}`]: at });
  return true;
}

// --- Membership ---------------------------------------------------------------

export async function addMembers(chatId: ChatId, newMemberIds: UserId[], byUid: UserId): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) throw new Error('chat not found');
  if (chat.kind !== 'group') throw new Error('cannot add members to a direct chat');
  const toAdd = newMemberIds.filter((m) => !chat.memberIds.includes(m));
  if (toAdd.length === 0) return;
  const readPatch = Object.fromEntries(toAdd.map((m) => [`lastReadAt.${m}`, 0]));
  await db.collection(CHATS).doc(chatId).update({
    memberIds: [...chat.memberIds, ...toAdd],
    ...readPatch,
    updatedAt: Date.now(),
  });
  await writeSystemMessage(chatId, `${toAdd.length} member(s) added`, [...chat.memberIds, ...toAdd]);
}

export async function removeMember(chatId: ChatId, memberId: UserId, byUid: UserId): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) throw new Error('chat not found');
  if (!chat.adminIds?.includes(byUid)) throw new Error('only admins can remove members');
  const members = chat.memberIds.filter((m) => m !== memberId);
  await db.collection(CHATS).doc(chatId).set({ memberIds: members, updatedAt: Date.now() }, { merge: true });
  await writeSystemMessage(chatId, 'A member was removed', members);
}

/**
 * "Delete" a chat for one member.
 *
 * Deliberately non-destructive: we stamp a per-member marker rather than
 * removing anything. The chat disappears from that member's list, everyone
 * else keeps their copy, and it comes back on its own if a newer message
 * arrives. Removing a member outright (or deleting the chat) would destroy the
 * other person's history, which "delete chat" should never do.
 */
export async function hideChatForMe(chatId: ChatId, uid: UserId): Promise<void> {
  // `update` with a dotted path, NOT `set` with a dotted key. React Native
  // Firebase expands dotted paths in `update` (that is how lastReadAt.uid is
  // written) but not in `set`, where the key landed as one flat field literally
  // named "hiddenFor.<uid>" — so the marker was never found on the next launch
  // and the chat came back.
  await db
    .collection(CHATS)
    .doc(chatId)
    .update({ [`hiddenFor.${uid}`]: Date.now(), updatedAt: Date.now() });
  log.info(`chat ${chatId} hidden for ${uid}`);
}

export async function leaveGroup(chatId: ChatId, uid: UserId): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const members = chat.memberIds.filter((m) => m !== uid);
  const admins = (chat.adminIds ?? []).filter((a) => a !== uid);
  await db.collection(CHATS).doc(chatId).set(
    { memberIds: members, adminIds: admins, updatedAt: Date.now() },
    { merge: true },
  );
  await writeSystemMessage(chatId, 'A member left', members);
}

export async function renameGroup(chatId: ChatId, name: string): Promise<void> {
  await db.collection(CHATS).doc(chatId).set({ name, updatedAt: Date.now() }, { merge: true });
}

export async function promoteToAdmin(chatId: ChatId, memberId: UserId): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) return;
  const admins = Array.from(new Set([...(chat.adminIds ?? []), memberId]));
  await db.collection(CHATS).doc(chatId).set({ adminIds: admins }, { merge: true });
}

// --- Typing indicators --------------------------------------------------------

export async function setTyping(chatId: ChatId, uid: UserId, typing: boolean): Promise<void> {
  const ref = db.collection(CHATS).doc(chatId).collection(TYPING).doc(uid);
  // Typing is best-effort: never let a failed write surface as an error.
  try {
    if (typing) await ref.set({ at: Date.now() });
    else await ref.delete();
  } catch (e) {
    log.debug('typing update skipped', e);
  }
}

/** Subscribe to the raw typing entries (callers decide what is stale). */
export function subscribeTyping(
  chatId: ChatId,
  exceptUid: UserId,
  cb: (entries: { uid: UserId; at: number }[]) => void,
): () => void {
  return db
    .collection(CHATS)
    .doc(chatId)
    .collection(TYPING)
    .onSnapshot(
      (snap) =>
        cb(
          snap.docs
            .filter((d) => d.id !== exceptUid)
            .map((d) => ({ uid: d.id, at: (d.data().at as number | undefined) ?? 0 })),
        ),
      (err) => log.debug('typing subscription error', err),
    );
}

// --- System messages ----------------------------------------------------------

async function writeSystemMessage(chatId: ChatId, text: string, memberIds: UserId[]): Promise<void> {
  const now = Date.now();
  const receipts = Object.fromEntries(memberIds.map((m) => [m, 'sent' as const]));
  const ref = await db
    .collection(CHATS)
    .doc(chatId)
    .collection(MESSAGES)
    .add({
      chatId,
      senderId: 'system',
      kind: 'system',
      envelopes: {},
      systemText: text,
      media: null,
      createdAt: now,
      receipts,
      clientId: randomId(8),
    });
  await updateChatPreview(chatId, text, now, ref.id);
}

// --- Resend requests ------------------------------------------------------------
// When a recipient can't decrypt a message (a used-up prekey, a reinstall, a
// simultaneous first message…) they ask the sender to re-encrypt it. The sender's
// app answers automatically (services/resend.ts). No server code involved.

const RESEND = 'resendRequests';

/** One request document per (requester, sender) pair, so several senders never clobber each other. */
export function resendRequestId(requesterUid: UserId, senderUid: UserId): string {
  return `${requesterUid}__${senderUid}`;
}

export interface ResendRequestDoc {
  id: string;
  requesterUid: UserId;
  senderUid: UserId;
  at: number;
  messageIds: string[];
  reset: boolean;
}

export async function requestResend(
  chatId: ChatId,
  requesterUid: UserId,
  senderUid: UserId,
  messageIds: string[],
  reset: boolean,
): Promise<void> {
  await db
    .collection(CHATS)
    .doc(chatId)
    .collection(RESEND)
    .doc(resendRequestId(requesterUid, senderUid))
    .set({ requesterUid, senderUid, at: Date.now(), messageIds, reset });
}

export function subscribeResendRequests(chatId: ChatId, cb: (requests: ResendRequestDoc[]) => void): () => void {
  return db
    .collection(CHATS)
    .doc(chatId)
    .collection(RESEND)
    .onSnapshot(
      (snap) =>
        cb(
          snap.docs.map((d) => {
            const x = d.data() as Partial<ResendRequestDoc>;
            return {
              id: d.id,
              requesterUid: x.requesterUid ?? '',
              senderUid: x.senderUid ?? '',
              at: x.at ?? 0,
              messageIds: x.messageIds ?? [],
              reset: !!x.reset,
            };
          }),
        ),
      (err) => log.warn('subscribeResendRequests failed', err),
    );
}

export async function clearResendRequest(chatId: ChatId, requestId: string): Promise<void> {
  await db.collection(CHATS).doc(chatId).collection(RESEND).doc(requestId).delete();
}
