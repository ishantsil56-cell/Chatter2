/**
 * Background chat sync — runs for the whole signed-in session, not just while a
 * chat screen is open:
 *   - marks incoming messages "delivered" the moment they reach this device,
 *   - decrypts new messages into the local cache (real previews in the list,
 *     nothing lost if a chat is never opened),
 *   - answers resend requests from people who couldn't read our messages.
 */

import { subscribeChats, subscribeResendRequests } from './chats';
import { syncRecent, previewText } from './messages';
import { serveResendRequests } from './resend';
import { presentMessageNotification } from './notifications';
import { getPlaintextSync } from './messageCache';
import { getUserFromCache } from '@/store/userCache';
import type { SessionManager } from './crypto/session';
import type { Chat, Message, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('chatSync');

/** The name a notification should show for a chat. */
function notificationTitle(chat: Chat, me: UserId): string {
  if (chat.kind === 'group') return chat.name ?? 'Group';
  const peerId = chat.memberIds.find((m) => m !== me);
  if (!peerId) return 'IRIS';
  const profile = getUserFromCache(peerId);
  return profile?.displayName || profile?.username || 'IRIS';
}

/** The body text, read from this device's decrypted cache (never from a server). */
function notificationBody(message: Message): string {
  const text = getPlaintextSync(message.id);
  if (text) return previewText(message.kind, text);
  return message.kind === 'text' ? 'New message' : 'Sent you an attachment';
}

export function startChatSync(crypto: SessionManager, uid: UserId): () => void {
  const handledAt = new Map<string, number>();
  /**
   * chatId -> id of the message already announced for that chat.
   *
   * The dedupe key is the message, not the chat's timestamp, because a chat
   * timestamp moves for reasons that are not a new message.
   */
  const lastNotified = new Map<string, string>();
  const chains = new Map<string, Promise<void>>();
  const resendUnsubs = new Map<string, () => void>();
  /** The first pass only records where each chat is up to — see onChats. */
  let primed = false;

  /** One chat's work runs strictly in order. */
  const enqueue = (chatId: string, job: () => Promise<void>): void => {
    const prev = chains.get(chatId) ?? Promise.resolve();
    chains.set(
      chatId,
      prev.then(job).catch((e) => log.warn(`sync job failed for ${chatId}`, e)),
    );
  };

  const onChats = (chats: Chat[]): void => {
    const live = new Set(chats.map((c) => c.id));

    for (const chat of chats) {
      const at = chat.lastMessageAt ?? 0;
      if ((handledAt.get(chat.id) ?? -1) < at) {
        // Captured now, before the async job runs: on the very first pass over
        // a signed-in session we only record positions, so signing in doesn't
        // fire a notification for every message already sitting in the inbox.
        const isFirstPass = !primed;
        handledAt.set(chat.id, at);
        enqueue(chat.id, async () => {
          const incoming = await syncRecent(crypto, chat.id, uid);
          if (!incoming) return;

          // A notification is about a MESSAGE, not about a chat moving.
          //
          // This used to fire whenever the chat's lastMessageAt advanced, which
          // is not the same thing. Edits, deletes, reactions, pins and read
          // bumps all move that timestamp without a new message arriving, so the
          // app produced a steady stream of notifications whose body fell back
          // to the literal words "New message", over chats with nothing new in
          // them. Deciding on the message id removes that whole class.
          const isMine = incoming.senderId === uid;
          const alreadyRead = incoming.createdAt <= (chat.lastReadAt?.[uid] ?? 0);

          if (isFirstPass) {
            // Record where this chat is up to, so signing in does not announce
            // the backlog — and remember the message, so the pass after it does
            // not announce the same one either.
            lastNotified.set(chat.id, incoming.id);
            return;
          }

          if (lastNotified.get(chat.id) === incoming.id) return;
          if (isMine || alreadyRead) return;

          lastNotified.set(chat.id, incoming.id);
          await presentMessageNotification({
            chatId: chat.id,
            title: notificationTitle(chat, uid),
            body: notificationBody(incoming),
          });
        });
      }
      if (!resendUnsubs.has(chat.id)) {
        resendUnsubs.set(
          chat.id,
          subscribeResendRequests(chat.id, (requests) => {
            if (requests.length === 0) return;
            enqueue(chat.id, async () => {
              await serveResendRequests(crypto, chat.id, uid, requests);
            });
          }),
        );
      }
    }

    for (const [chatId, unsub] of resendUnsubs) {
      if (!live.has(chatId)) {
        unsub();
        resendUnsubs.delete(chatId);
      }
    }

    primed = true;
  };

  const unsubChats = subscribeChats(uid, onChats);
  return () => {
    unsubChats();
    resendUnsubs.forEach((u) => u());
    resendUnsubs.clear();
  };
}
