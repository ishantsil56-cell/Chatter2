/**
 * Block list + abuse reports (Phase 1.4).
 *
 * A block is a private document `users/{uid}/blocks/{blockedUid}`. Only the
 * owner can read or write their own list, so nobody can enumerate who
 * blocked them — the server-side send checks in firestore.rules enforce
 * blocks with get()/exists() without ever revealing the list.
 *
 * What a block does and does not do (say this plainly in the UI):
 *   - Stops the blocked person messaging you in a direct chat (rules).
 *   - Hides their messages from you everywhere, including groups (client
 *     filter in ChatScreen).
 *   - Stops YOU messaging them (client gates in ensureDirectChat and
 *     prepareMessage) — unblock first.
 *   - Does NOT remove either of you from shared groups, hide your profile
 *     from them, or stop the content-free "New message" push (the Worker
 *     does not check blocks yet). Group removal is removeMember.
 */
import { db } from './firebase';
import { UserError } from '@/utils/errors';
import type { UserId } from '@/types';

export interface BlockEntry {
  blockedUid: UserId;
  at: number;
}

function blocksRef(uid: UserId) {
  return db.collection('users').doc(uid).collection('blocks');
}

/** Live list of uids this user blocked. */
export function subscribeBlocks(uid: UserId, cb: (uids: UserId[]) => void): () => void {
  return blocksRef(uid).onSnapshot((snap) => cb(snap.docs.map((d) => d.id as UserId)));
}

export async function blockUser(uid: UserId, blockedUid: UserId): Promise<void> {
  if (uid === blockedUid) throw new UserError("You can't block yourself.");
  const entry: BlockEntry = { blockedUid, at: Date.now() };
  await blocksRef(uid).doc(blockedUid).set(entry);
}

export async function unblockUser(uid: UserId, blockedUid: UserId): Promise<void> {
  await blocksRef(uid).doc(blockedUid).delete();
}

export async function isBlocked(uid: UserId, peerUid: UserId): Promise<boolean> {
  return (await blocksRef(uid).doc(peerUid).get()).exists;
}

/**
 * File a report. Write-only: the rules let nobody read reports back, and
 * there is no admin console yet — reports are stored for future
 * moderation, not acted on automatically. The UI must say so.
 */
export async function reportUser(uid: UserId, reportedUid: UserId, reason: string): Promise<void> {
  await db.collection('reports').add({ reporterUid: uid, reportedUid, reason, at: Date.now() });
}
