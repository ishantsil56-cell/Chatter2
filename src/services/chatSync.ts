/**
 * Background chat sync — runs for the whole signed-in session, not just while a
 * chat screen is open:
 *   - marks incoming messages "delivered" the moment they reach this device,
 *   - decrypts new messages into the local cache (real previews in the list,
 *     nothing lost if a chat is never opened),
 *   - answers resend requests from people who couldn't read our messages.
 */

import { subscribeChats, subscribeResendRequests } from './chats';
import { syncRecent } from './messages';
import { serveResendRequests } from './resend';
import type { SessionManager } from './crypto/session';
import type { Chat, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('chatSync');

export function startChatSync(crypto: SessionManager, uid: UserId): () => void {
  const handledAt = new Map<string, number>();
  const chains = new Map<string, Promise<void>>();
  const resendUnsubs = new Map<string, () => void>();

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
        handledAt.set(chat.id, at);
        enqueue(chat.id, async () => {
          await syncRecent(crypto, chat.id, uid);
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
  };

  const unsubChats = subscribeChats(uid, onChats);
  return () => {
    unsubChats();
    resendUnsubs.forEach((u) => u());
    resendUnsubs.clear();
  };
}
