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
  return db
    .collection(CHATS)
    .where('memberIds', 'array-contains', uid)
    .orderBy('lastMessageAt', 'desc')
    .onSnapshot(
      (snap) => cb(snap.docs.map((d) => d.data() as Chat)),
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
export async function updateChatPreview(chatId: ChatId, preview: string, at: number): Promise<void> {
  await db.collection(CHATS).doc(chatId).set(
    { lastMessageAt: at, lastMessagePreview: preview, updatedAt: at },
    { merge: true },
  );
}

/** Advance a member's read cursor. */
export async function setLastRead(chatId: ChatId, uid: UserId, at: number): Promise<void> {
  await db.collection(CHATS).doc(chatId).set({ [`lastReadAt.${uid}`]: at }, { merge: true });
}

// --- Membership ---------------------------------------------------------------

export async function addMembers(chatId: ChatId, newMemberIds: UserId[], byUid: UserId): Promise<void> {
  const chat = await getChat(chatId);
  if (!chat) throw new Error('chat not found');
  if (chat.kind !== 'group') throw new Error('cannot add members to a direct chat');
  const toAdd = newMemberIds.filter((m) => !chat.memberIds.includes(m));
  if (toAdd.length === 0) return;
  const readPatch = Object.fromEntries(toAdd.map((m) => [`lastReadAt.${m}`, 0]));
  await db.collection(CHATS).doc(chatId).set(
    { memberIds: [...chat.memberIds, ...toAdd], ...readPatch, updatedAt: Date.now() },
    { merge: true },
  );
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
  if (typing) await ref.set({ at: Date.now() });
  else await ref.delete();
}

/** Subscribe to who is currently typing (ignoring stale entries > 6s old). */
export function subscribeTyping(
  chatId: ChatId,
  exceptUid: UserId,
  cb: (typingUids: UserId[]) => void,
): () => void {
  return db
    .collection(CHATS)
    .doc(chatId)
    .collection(TYPING)
    .onSnapshot((snap) => {
      const cutoff = Date.now() - 6000;
      const uids = snap.docs
        .filter((d) => d.id !== exceptUid && (d.data().at ?? 0) > cutoff)
        .map((d) => d.id);
      cb(uids);
    });
}

// --- System messages ----------------------------------------------------------

async function writeSystemMessage(chatId: ChatId, text: string, memberIds: UserId[]): Promise<void> {
  const now = Date.now();
  const receipts = Object.fromEntries(memberIds.map((m) => [m, 'sent' as const]));
  await db
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
  await updateChatPreview(chatId, text, now);
}
