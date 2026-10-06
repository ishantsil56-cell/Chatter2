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
          if (isFirstPass || !incoming) return;
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
