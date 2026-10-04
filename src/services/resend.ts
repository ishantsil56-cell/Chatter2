/**
 * Answering "please resend" requests.
 *
 * A recipient who can't decrypt a message (used-up prekey, reinstall, glare…)
 * writes a resend request (see chats.requestResend). When the SENDER's app sees
 * it, it re-encrypts the original text for that recipient — from its local cache
 * or its history-key copy — and swaps the new envelope into the existing message.
 * Nothing leaves the device in the clear, and no server code is needed.
 *
 * If the request asks for a reset (the recipient has no way to read our current
 * session), we start a fresh handshake that uses the SIGNED prekey only, which
 * cannot collide with anybody else's use of a one-time prekey.
 */

import { db } from './firebase';
import { ensureSessions, replaceEnvelope } from './messages';
import { getPlaintext } from './messageCache';
import { openSelfEnvelope } from './historyKey';
import { clearResendRequest, type ResendRequestDoc } from './chats';
import type { SessionManager } from './crypto/session';
import type { Message, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('resend');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGES_PER_REQUEST = 50;

const handled = new Set<string>();

/** Serve one chat's pending requests. Returns how many messages were re-sent. */
export async function serveResendRequests(
  crypto: SessionManager,
  chatId: string,
  myUid: UserId,
  requests: ResendRequestDoc[],
): Promise<number> {
  let resent = 0;
  for (const req of requests) {
    if (req.senderUid !== myUid || req.requesterUid === myUid) continue; // not ours to answer
    const key = `${chatId}:${req.id}:${req.at}`;
    if (handled.has(key)) continue;
    handled.add(key);

    try {
      if (Date.now() - req.at > MAX_AGE_MS) {
        await clearResendRequest(chatId, req.id);
        continue;
      }

      if (req.reset) {
        await crypto.resetSession(req.requesterUid);
        await ensureSessions(crypto, myUid, [myUid, req.requesterUid], { withoutOneTimePreKey: true });
      } else {
        await ensureSessions(crypto, myUid, [myUid, req.requesterUid]);
      }

      const messages: Message[] = [];
      for (const id of req.messageIds.slice(0, MAX_MESSAGES_PER_REQUEST)) {
        const snap = await db.collection('chats').doc(chatId).collection('messages').doc(id).get();
        if (!snap.exists) continue;
        const m = { id: snap.id, ...snap.data() } as Message;
        if (m.senderId === myUid && m.envelopes?.[req.requesterUid]) messages.push(m);
      }
      messages.sort((a, b) => a.createdAt - b.createdAt);

      for (const m of messages) {
        let text = await getPlaintext(m.id);
        if (text === undefined && m.selfEnvelope) text = (await openSelfEnvelope(myUid, m.selfEnvelope)) ?? undefined;
        if (text === undefined) {
          log.warn(`cannot re-send ${m.id}: our own copy is not available`);
          continue;
        }
        const payload = await crypto.encrypt(req.requesterUid, text);
        await replaceEnvelope(chatId, m.id, req.requesterUid, { ciphertext: payload.ciphertext, header: payload.header });
        resent += 1;
      }
      await clearResendRequest(chatId, req.id);
    } catch (e) {
      handled.delete(key); // try again on the next snapshot
      log.warn('could not serve resend request', e);
    }
  }
  return resent;
}

export function resetResendForTests(): void {
  handled.clear();
}
