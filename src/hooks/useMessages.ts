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
import { InteractionManager } from 'react-native';
import { getCrypto } from '@/services/crypto';
import {
  subscribeMessages,
  decryptMessage,
  envelopeSignature,
  PAGE_SIZE,
  type RawMessage,
  type ReplyRef,
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
  sendText: (text: string, replyTo?: ReplyRef | null, mentions?: UserId[]) => Promise<void>;
  sendMedia: (kind: 'image' | 'voice' | 'file', media: MediaDescriptor, mediaKey: string, caption?: string) => Promise<void>;
  /**
   * Show a photo or voice note immediately, before it has finished uploading.
   * Returns the id the finished message will use, so the bubble does not flicker
   * when the real send replaces the staged one.
   */
  beginMediaSend: (kind: 'image' | 'voice' | 'file', localUri: string, caption?: string) => string | null;
  /** Report upload progress for a staged send, 0..1. */
  updateMediaProgress: (id: string, progress: number) => void;
  /** Upload finished: hand the encrypted descriptor over and actually send it. */
  finishMediaSend: (id: string, media: MediaDescriptor, mediaKey: string, caption?: string) => Promise<void>;
  /** Upload failed: keep the bubble, marked as failed, with a reason. */
  failMediaSend: (id: string, message: string) => void;
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

/** A photo or voice note that is on screen but not yet sent. */
interface StagedMedia {
  id: string;
  chatId: string;
  senderId: UserId;
  kind: 'image' | 'voice' | 'file';
  /** The file on this device, rendered while the upload runs. */
  localUri: string;
  caption: string;
  createdAt: number;
  /** 0..1. */
  progress: number;
  error?: string;
}

/** A local id, used before the message has a server identity. */
function localId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function sameReceipts(a: DecryptedMessage['receipts'], b: DecryptedMessage['receipts']): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra);
  const kb = Object.keys(rb);
  return ka.length === kb.length && ka.every((k) => ra[k] === rb[k]);
}

/**
 * The previous object, when everything a bubble renders is unchanged — else
 * the new one. Every field below is something a bubble actually shows; fields
 * it never renders (envelopes, clientId) are deliberately left out, so a
 * resend or a re-encryption that changes nothing visible costs no re-render.
 */
function pick(prev: DecryptedMessage | undefined, next: DecryptedMessage): DecryptedMessage {
  if (
    prev &&
    prev.id === next.id &&
    prev.senderId === next.senderId &&
    prev.kind === next.kind &&
    prev.createdAt === next.createdAt &&
    prev.systemText === next.systemText &&
    prev.text === next.text &&
    prev.decrypted === next.decrypted &&
    prev.decryptIssue === next.decryptIssue &&
    prev.sendState === next.sendState &&
    prev.outboxId === next.outboxId &&
    prev.sendError === next.sendError &&
    prev.deletedForEveryone === next.deletedForEveryone &&
    prev.ephemeralTtlMs === next.ephemeralTtlMs &&
    prev.expiresAt === next.expiresAt &&
    prev.media === next.media &&
    prev.localUri === next.localUri &&
    prev.uploadProgress === next.uploadProgress &&
    prev.uploading === next.uploading &&
    prev.uploadError === next.uploadError &&
    prev.pending === next.pending &&
    sameReceipts(prev.receipts, next.receipts)
  ) {
    return prev;
  }
  return next;
}

export function useMessages(
  chatId: string | null,
  myUid: UserId | null,
  memberIds: UserId[],
  opts?: { ephemeralTtlMs?: number },
): UseMessagesResult {
  const [raw, setRaw] = useState<RawMessage[]>([]);
  const [readable, setReadable] = useState<Record<string, Readable>>({});
  const [outbox, setOutbox] = useState<OutboxItem[]>([]);
  // Media that is on screen but not yet sent.
  //
  // Deliberately NOT in the outbox: the outbox is encrypted, persisted and
  // replayable, and an upload in flight has no ciphertext to replay yet. A short
  // lived staging list gives the same visible behaviour — the bubble appears at
  // once and fills in as it uploads — without teaching the durable queue a state
  // it cannot resume.
  const [staged, setStaged] = useState<StagedMedia[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const memberIdsRef = useRef<UserId[]>(memberIds);
  memberIdsRef.current = memberIds;
  // Disappearing-message TTL for this chat (0/undefined = off). Captured on
  // each new message at send time via SendParams.ephemeralTtlMs.
  const ephemeralTtlMs = opts?.ephemeralTtlMs;
  const ephemeralRef = useRef<number | undefined>(ephemeralTtlMs);
  ephemeralRef.current = ephemeralTtlMs;

  // Per chat: what we've read, what failed (and against which ciphertext), and request counts.
  const successes = useRef<Map<string, Readable>>(new Map());
  const failures = useRef<Map<string, { signature: string; value: Readable }>>(new Map());
  const autoRequests = useRef<Map<string, number>>(new Map());
  const forceRetry = useRef(false);
  const lastRaw = useRef<RawMessage[]>([]);
  const processing = useRef<Promise<void>>(Promise.resolve());
  // Previous message objects, by id — for keeping their identity stable (see pick() below).
  const prevMessages = useRef(new Map<string, DecryptedMessage>());
  // The first snapshot's decrypt pass is deferred past the transition (below).
  const firstSnapshotEnqueued = useRef(false);

  // Reset per-chat state when the chat changes.
  useEffect(() => {
    successes.current = new Map();
    failures.current = new Map();
    autoRequests.current = new Map();
    lastRaw.current = [];
    prevMessages.current = new Map();
    firstSnapshotEnqueued.current = false;
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

      /** Publish what we have so far, so messages appear as they decrypt. */
      const publish = (): void => {
        const merged: Record<string, Readable> = {};
        for (const m of messages) {
          const v = successes.current.get(m.id) ?? failures.current.get(m.id)?.value;
          if (v) merged[m.id] = v;
        }
        setReadable(merged);
      };

      const attemptAll = async (): Promise<boolean> => {
        let progress = false;
        let sincePublish = 0;
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
            // Show progress mid-batch: opening a long chat used to stay blank
            // until every single message had been decrypted.
            if (++sincePublish >= 8) {
              sincePublish = 0;
              publish();
            }
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

      publish();

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
        const enqueue = () => {
          processing.current = processing.current
            .then(() => processSnapshot(messages, myUid, chatId, () => cancelled))
            .catch((e) => log.warn('processing snapshot failed', e))
            .then(() => {
              if (cancelled) return;
              setLoading(false);
              setLoadingOlder(false);
            });
        };
        if (!firstSnapshotEnqueued.current) {
          // The first decrypt pass is the heavy one, and it used to run
          // straight through the screen-transition animation — crypto on the
          // JS thread while the slide animates is what made opening a chat
          // stutter. Let the transition finish first; later snapshots (new
          // messages arriving) process immediately.
          firstSnapshotEnqueued.current = true;
          InteractionManager.runAfterInteractions(enqueue);
        } else {
          enqueue();
        }
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
    // Reuse the previous object when nothing the bubble renders has changed.
    //
    // MessageBubble is memoised on message identity, but this list used to
    // rebuild every object on each decrypt pass — so as a chat opened and
    // messages decrypted one at a time, the whole visible list re-rendered
    // dozens of times, re-running the mention parser and media parse on text
    // that had not changed. That storm is the chat lag. With stable identity,
    // only the row that actually changed re-renders.
    const prev = prevMessages.current;
    const next = new Map<string, DecryptedMessage>();
    const failedIds = new Set(outbox.filter((i) => i.state === 'failed').map((i) => i.id));

    for (const m of raw) {
      seen.add(m.id);
      const r = readable[m.id];
      const candidate: DecryptedMessage = {
        ...m,
        text: m.kind === 'system' ? m.systemText ?? null : r?.text ?? null,
        decrypted: m.kind === 'system' ? true : r?.decrypted ?? false,
        decryptIssue: r?.decryptIssue,
      };
      if (m.pendingWrite && m.senderId === myUid) candidate.sendState = 'sending';
      // Link outbox ids onto failed-after-write messages too (rare: server rejected the write).
      if (failedIds.has(m.id)) {
        candidate.sendState = 'failed';
        candidate.outboxId = m.id;
        candidate.sendError = outbox.find((i) => i.id === m.id)?.friendlyError;
      }
      const item = pick(prev.get(m.id), candidate);
      out.push(item);
      next.set(m.id, item);
    }

    // Media still uploading, or whose upload failed. Rendered from the local
    // file so the sender sees their own picture instantly.
    for (const s of staged) {
      if (s.chatId !== chatId || seen.has(s.id)) continue;
      const candidate: DecryptedMessage = {
        id: s.id,
        chatId: s.chatId,
        senderId: s.senderId,
        kind: s.kind,
        envelopes: {},
        media: null,
        systemText: null,
        createdAt: s.createdAt,
        receipts: {},
        clientId: s.id,
        text: '',
        decrypted: true,
        pending: true,
        sendState: s.error ? 'failed' : 'sending',
        sendError: s.error,
        localUri: s.localUri,
        uploadProgress: s.progress,
        uploading: !s.error,
        uploadError: s.error,
      };
      if (failedIds.has(s.id)) {
        candidate.sendState = 'failed';
        candidate.outboxId = s.id;
        candidate.sendError = outbox.find((i) => i.id === s.id)?.friendlyError;
      }
      const item = pick(prev.get(s.id), candidate);
      out.push(item);
      next.set(s.id, item);
    }

    // Our own messages that haven't reached Firestore yet (or failed to).
    for (const item of outbox) {
      if (item.params.chatId !== chatId || seen.has(item.id)) continue;
      const candidate: DecryptedMessage = {
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
      };
      const picked = pick(prev.get(item.id), candidate);
      out.push(picked);
      next.set(item.id, picked);
    }

    prevMessages.current = next;
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }, [raw, readable, outbox, chatId, myUid]);

  const loadOlder = useCallback(() => {
    if (!hasMore || loadingOlder) return;
    setLoadingOlder(true);
    setLimit((l) => l + PAGE_SIZE);
  }, [hasMore, loadingOlder]);

  const sendText = useCallback(
    async (text: string, replyTo?: ReplyRef | null, mentions?: UserId[]) => {
      if (!chatId || !myUid) return;
      await enqueue({
        chatId,
        senderId: myUid,
        memberIds: memberIdsRef.current,
        kind: 'text',
        text,
        replyTo: replyTo ?? null,
        mentions: mentions ?? [],
        ephemeralTtlMs: ephemeralRef.current,
      });
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
        ephemeralTtlMs: ephemeralRef.current,
      });
    },
    [chatId, myUid],
  );

  /** Put the picture on screen now, before any bytes have moved. */
  const beginMediaSend = useCallback(
    (kind: 'image' | 'voice' | 'file', localUri: string, caption = ''): string | null => {
      if (!chatId || !myUid) return null;
      const id = localId();
      setStaged((current) => [
        ...current,
        { id, chatId, senderId: myUid, kind, localUri, caption, createdAt: Date.now(), progress: 0 },
      ]);
      return id;
    },
    [chatId, myUid],
  );

  const updateMediaProgress = useCallback((id: string, progress: number) => {
    setStaged((current) => current.map((s) => (s.id === id ? { ...s, progress } : s)));
  }, []);

  /**
   * Hand the encrypted descriptor over and send for real.
   *
   * The staged entry is removed and the outbox takes over under the SAME id, so
   * the bubble keeps its identity and does not blink out and reappear.
   */
  const finishMediaSend = useCallback(
    async (id: string, media: MediaDescriptor, mediaKey: string, caption = '') => {
      if (!chatId || !myUid) return;
      setStaged((current) => current.filter((s) => s.id !== id));
      await enqueue({
        chatId,
        senderId: myUid,
        memberIds: memberIdsRef.current,
        kind: media.mimeType.startsWith('audio') ? 'voice' : 'image',
        text: encodeMediaBody(mediaKey, caption),
        media,
        clientId: id,
        ephemeralTtlMs: ephemeralRef.current,
      });
    },
    [chatId, myUid],
  );

  const failMediaSend = useCallback((id: string, message: string) => {
    setStaged((current) => current.map((s) => (s.id === id ? { ...s, error: message } : s)));
  }, []);

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
    beginMediaSend,
    updateMediaProgress,
    finishMediaSend,
    failMediaSend,
    retrySend: retryOutbox,
    discardSend: discardOutbox,
    retryDecrypt,
  };
}
