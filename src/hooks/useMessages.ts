/**
 * Live, decrypted message feed for one chat.
 *
 * - Pages: starts with the newest PAGE_SIZE messages; `loadOlder()` widens the window.
 * - Decrypts each message exactly once (see services/messages.ts); successes are
 *   cached, failures are retried only when something changed (new ciphertext from
 *   a resend, a later message that established the session, or a manual retry).
 * - Merges in the outbox so our own messages show "sending" / "failed" immediately.
 * - Asks senders to re-send messages we can't read (capped, so it can't ping-pong).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCrypto } from '@/services/crypto';
import {
  subscribeMessages,
  decryptMessage,
  envelopeSignature,
  PAGE_SIZE,
  type RawMessage,
} from '@/services/messages';
import { encodeMediaBody } from '@/services/storage';
import { enqueue, retry as retryOutbox, discard as discardOutbox, subscribeOutbox, type OutboxItem } from '@/services/outbox';
import { requestResend } from '@/services/chats';
import { friendlyError } from '@/utils/errors';
import type { DecryptedMessage, MediaDescriptor, UserId } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('useMessages');
const MAX_AUTO_RESEND_REQUESTS = 2;

export interface UseMessagesResult {
  messages: DecryptedMessage[];
  loading: boolean;
  /** Probably older messages on the server. */
  hasMore: boolean;
  loadingOlder: boolean;
  /** Set when the live feed itself fails (permissions, offline at first load…). */
  feedError: string | null;
  loadOlder: () => void;
  sendText: (text: string) => Promise<void>;
  sendMedia: (kind: 'image' | 'voice' | 'file', media: MediaDescriptor, mediaKey: string, caption?: string) => Promise<void>;
  /** Retry sending a failed message. */
  retrySend: (outboxId: string) => Promise<void>;
  /** Drop a failed message. */
  discardSend: (outboxId: string) => Promise<void>;
  /** Try reading undecryptable messages again and ask senders to re-send them. */
  retryDecrypt: () => Promise<void>;
}

interface Readable {
  text: string | null;
  decrypted: boolean;
  decryptIssue?: DecryptedMessage['decryptIssue'];
}

export function useMessages(chatId: string | null, myUid: UserId | null, memberIds: UserId[]): UseMessagesResult {
  const [raw, setRaw] = useState<RawMessage[]>([]);
  const [readable, setReadable] = useState<Record<string, Readable>>({});
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const memberIdsRef = useRef<UserId[]>(memberIds);
  memberIdsRef.current = memberIds;

  // Per chat: what we've read, what failed (and against which ciphertext), and request counts.
  const successes = useRef<Map<string, Readable>>(new Map());
  const failures = useRef<Map<string, { signature: string; value: Readable }>>(new Map());
  const autoRequests = useRef<Map<string, number>>(new Map());
  const forceRetry = useRef(false);
  const lastRaw = useRef<RawMessage[]>([]);
  const processing = useRef<Promise<void>>(Promise.resolve());

  // Reset per-chat state when the chat changes.
  useEffect(() => {
    successes.current = new Map();
    failures.current = new Map();
    autoRequests.current = new Map();
    lastRaw.current = [];
    setRaw([]);
    setReadable({});
    setLimit(PAGE_SIZE);
    setHasMore(false);
    setLoading(true);
    setFeedError(null);
  }, [chatId]);

  useEffect(() => subscribeOutbox(setOutbox), []);

  const processSnapshot = useCallback(
    async (messages: RawMessage[], uid: UserId, id: string, isCancelled: () => boolean) => {
      const crypto = getCrypto();
      const attemptAll = async (): Promise<boolean> => {
        let progress = false;
        for (const m of messages) {
          if (successes.current.has(m.id)) continue;
          const signature = envelopeSignature(m, uid);
          const failed = failures.current.get(m.id);
          if (failed && failed.signature === signature && !forceRetry.current) continue;
          const result = await decryptMessage(crypto, m, uid);
          const value: Readable = { text: result.text, decrypted: result.decrypted, decryptIssue: result.decryptIssue };
          if (result.decrypted) {
            successes.current.set(m.id, value);
            failures.current.delete(m.id);
            progress = true;
          } else {
            failures.current.set(m.id, { signature, value });
          }
        }
        return progress;
      };

      // A later message can establish the session an earlier one needed: loop while we make progress.
      let again = true;
      for (let pass = 0; again && pass < 3; pass++) again = (await attemptAll()) && failures.current.size > 0;
      forceRetry.current = false;
      if (isCancelled()) return;

      const merged: Record<string, Readable> = {};
      for (const m of messages) {
        const v = successes.current.get(m.id) ?? failures.current.get(m.id)?.value;
        if (v) merged[m.id] = v;
      }
      setReadable(merged);

      // Ask senders to re-send what we can't read (a couple of times at most).
      const bySender = new Map<string, string[]>();
      for (const m of messages) {
        const f = failures.current.get(m.id);
        if (!f || f.value.decryptIssue === 'unavailable' || m.senderId === uid) continue;
        const n = autoRequests.current.get(m.id) ?? 0;
        if (n >= MAX_AUTO_RESEND_REQUESTS) continue;
        autoRequests.current.set(m.id, n + 1);
        bySender.set(m.senderId, [...(bySender.get(m.senderId) ?? []), m.id]);
      }
      for (const [sender, ids] of bySender) {
        const reset = ids.some((mid) => failures.current.get(mid)?.value.decryptIssue === 'failed');
        void requestResend(id, uid, sender, ids, reset).catch((e) => log.warn('resend request failed', e));
      }
    },
    [],
  );

  useEffect(() => {
    if (!chatId || !myUid) return;
    let cancelled = false;

    const unsub = subscribeMessages(
      chatId,
      (messages, info) => {
        lastRaw.current = messages;
        setRaw(messages);
        setHasMore(info.hasMore);
        // Decrypt strictly one snapshot at a time, in order.
        processing.current = processing.current
          .then(() => processSnapshot(messages, myUid, chatId, () => cancelled))
          .catch((e) => log.warn('processing snapshot failed', e))
          .then(() => {
            if (cancelled) return;
            setLoading(false);
            setLoadingOlder(false);
          });
      },
      limit,
      (e) => {
        if (cancelled) return;
        setFeedError(friendlyError(e, 'Couldn’t load this chat.'));
        setLoading(false);
        setLoadingOlder(false);
      },
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [chatId, myUid, limit, processSnapshot]);

  const messages = useMemo<DecryptedMessage[]>(() => {
    const out: DecryptedMessage[] = [];
    const seen = new Set<string>();

    for (const m of raw) {
      seen.add(m.id);
      const r = readable[m.id];
      const base: DecryptedMessage = {
        ...m,
        text: m.kind === 'system' ? m.systemText ?? null : r?.text ?? null,
        decrypted: m.kind === 'system' ? true : r?.decrypted ?? false,
        decryptIssue: r?.decryptIssue,
      };
      if (m.pendingWrite && m.senderId === myUid) base.sendState = 'sending';
      out.push(base);
    }

    // Our own messages that haven't reached Firestore yet (or failed to).
    for (const item of outbox) {
      if (item.params.chatId !== chatId || seen.has(item.id)) continue;
      out.push({
        id: item.id,
        chatId: item.params.chatId,
        senderId: item.params.senderId,
        kind: item.params.kind,
        envelopes: {},
        media: item.params.media ?? null,
        systemText: null,
        createdAt: item.params.createdAt,
        receipts: {},
        clientId: item.id,
        text: item.params.text ?? '',
        decrypted: true,
        pending: true,
        sendState: item.state === 'failed' ? 'failed' : 'sending',
        sendError: item.friendlyError,
        outboxId: item.id,
      });
    }

    // Link outbox ids onto failed-after-write messages too (rare: server rejected the write).
    const failedIds = new Set(outbox.filter((i) => i.state === 'failed').map((i) => i.id));
    for (const m of out) {
      if (failedIds.has(m.id)) {
        m.sendState = 'failed';
        m.outboxId = m.id;
        m.sendError = outbox.find((i) => i.id === m.id)?.friendlyError;
      }
    }

    return out.sort((a, b) => a.createdAt - b.createdAt);
  }, [raw, readable, outbox, chatId, myUid]);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder) return;
    setLoadingOlder(true);
    setLimit((l) => l + PAGE_SIZE);
  }, [hasMore, loadingOlder]);

  const sendText = useCallback(
    async (text: string) => {
      if (!chatId || !myUid) return;
      await enqueue({ chatId, senderId: myUid, memberIds: memberIdsRef.current, kind: 'text', text });
    },
    [chatId, myUid],
  );

  const sendMedia = useCallback(
    async (kind: 'image' | 'voice' | 'file', media: MediaDescriptor, mediaKey: string, caption = '') => {
      if (!chatId || !myUid) return;
      await enqueue({
        chatId,
        senderId: myUid,
        memberIds: memberIdsRef.current,
        kind,
        // The media key rides inside the E2EE body, never to the server in clear.
        text: encodeMediaBody(mediaKey, caption),
        media,
      });
    },
    [chatId, myUid],
  );

  const retryDecrypt = useCallback(async () => {
    if (!chatId || !myUid) return;
    forceRetry.current = true;
    autoRequests.current = new Map();
    const messagesNow = lastRaw.current;
    processing.current = processing.current
      .then(() => processSnapshot(messagesNow, myUid, chatId, () => false))
      .catch((e) => log.warn('retry failed', e));
    await processing.current;
  }, [chatId, myUid, processSnapshot]);

  return {
    messages,
    loading,
    hasMore,
    loadingOlder,
    feedError,
    loadOlder,
    sendText,
    sendMedia,
    retrySend: retryOutbox,
    discardSend: discardOutbox,
    retryDecrypt,
  };
}
