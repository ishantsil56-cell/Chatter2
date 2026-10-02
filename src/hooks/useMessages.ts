/**
 * Live, decrypted message feed for one chat.
 *
 * Decryption is stateful (the Double Ratchet advances with every message), so
 * we decrypt each message exactly once and remember its plaintext, rather than
 * re-decrypting the whole list on every snapshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCrypto } from '@/services/crypto';
import { subscribeMessages, decryptMessage, markDelivered, sendMessage } from '@/services/messages';
import { encodeMediaBody } from '@/services/storage';
import { enqueue } from '@/services/outbox';
import type { DecryptedMessage, MediaDescriptor, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('useMessages');

export interface UseMessagesResult {
  messages: DecryptedMessage[];
  loading: boolean;
  sendText: (text: string) => Promise<void>;
  sendMedia: (kind: 'image' | 'voice' | 'file', media: MediaDescriptor, mediaKey: string, caption?: string) => Promise<void>;
}

export function useMessages(chatId: string | null, myUid: UserId | null, memberIds: UserId[]): UseMessagesResult {
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const plaintext = useRef<Map<string, DecryptedMessage>>(new Map());
  const memberIdsRef = useRef<UserId[]>(memberIds);
  memberIdsRef.current = memberIds;

  useEffect(() => {
    if (!chatId || !myUid) return;
    const crypto = getCrypto();
    plaintext.current = new Map();

    let cancelled = false;

    const unsub = subscribeMessages(chatId, (raw) => {
      void (async () => {
        for (const message of raw) {
          if (plaintext.current.has(message.id)) continue;
          const decrypted = await decryptMessage(crypto, message, myUid);
          plaintext.current.set(message.id, decrypted);
        }
        if (cancelled) return;

        const ordered = raw
          .map((m) => plaintext.current.get(m.id))
          .filter((m): m is DecryptedMessage => Boolean(m));
        setMessages(ordered);
        setLoading(false);

        // Acknowledge delivery of anything from someone else we haven't acked.
        for (const message of raw) {
          if (message.senderId !== myUid && message.receipts?.[myUid] === 'sent') {
            void markDelivered(chatId, message.id, myUid);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [chatId, myUid]);

  const sendText = useCallback(
    async (text: string) => {
      if (!chatId || !myUid) return;
      const params = {
        chatId,
        senderId: myUid,
        memberIds: memberIdsRef.current,
        kind: 'text' as const,
        text,
      };
      try {
        await sendMessage(getCrypto(), params);
      } catch (e) {
        log.warn('send failed, queueing', e);
        await enqueue(params);
      }
    },
    [chatId, myUid],
  );

  const sendMedia = useCallback(
    async (kind: 'image' | 'voice' | 'file', media: MediaDescriptor, mediaKey: string, caption = '') => {
      if (!chatId || !myUid) return;
      const params = {
        chatId,
        senderId: myUid,
        memberIds: memberIdsRef.current,
        kind,
        // The media key rides inside the E2EE body, never to the server in clear.
        text: encodeMediaBody(mediaKey, caption),
        media,
      };
      try {
        await sendMessage(getCrypto(), params);
      } catch (e) {
        log.warn('media send failed, queueing', e);
        await enqueue(params);
      }
    },
    [chatId, myUid],
  );

  return { messages, loading, sendText, sendMedia };
}
