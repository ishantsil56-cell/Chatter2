/**
 * SessionManager — the public face of the E2EE layer.
 *
 * It ties together identity/prekeys (./identity.ts), the X3DH handshake
 * (./x3dh.ts) and the Double Ratchet (./ratchet.ts), and exposes the two calls
 * the rest of the app actually needs:
 *
 *   await crypto.encrypt(peerId, "hello")   -> { ciphertext, header }
 *   await crypto.decrypt(peerId, key, msg)  -> "hello"
 *
 * Wire format (`EncryptedPayload`) maps 1:1 onto the `ciphertext` + `header`
 * fields of a Firestore message envelope.
 *
 * All operations for a given peer are serialised through a per-peer lock, so a
 * burst of concurrent messages can't corrupt the ratchet state.
 *
 * Reliability rules (each one fixes a failure we actually hit):
 *  - A session is only ever persisted AFTER a message decrypts with it. A bad or
 *    unusable first message therefore can't leave a poisoned session behind.
 *  - A one-time prekey is only consumed after a successful decrypt.
 *  - The X3DH header stays on outbound messages until the peer answers, so the
 *    first message being dropped or retried doesn't strand the conversation.
 *  - A message carrying a *new* handshake replaces an unusable session (peer
 *    reinstalled / reset). Simultaneous first messages ("glare") are resolved
 *    deterministically: the session started by the lower identity key wins.
 *  - Handshakes we've already adopted are remembered, so replaying an old first
 *    message can't reset a live session.
 */

import { b64, fromB64, type KeyPair } from './primitives';
import { concatBytes, utf8ToBytes, bytesToUtf8 } from '@/utils/bytes';
import {
  createIdentity,
  publicBundle,
  safetyNumber,
  topUpOneTimePreKeys,
  ONE_TIME_PREKEY_COUNT,
  type LocalIdentity,
} from './identity';
import { DoubleRatchet } from './ratchet';
import { x3dhInitiate, x3dhRespond, type RemotePreKeyBundle } from './x3dh';
import type { KeyStore, StoredSession } from './store';
import type { CipherHeader } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('crypto/session');
const AD_LABEL = 'IRISSessionV1';
const MAX_REMEMBERED_HANDSHAKES = 20;
const REPLENISH_BELOW = 10;

export interface EncryptedPayload {
  ciphertext: string;
  header: CipherHeader;
}

export type CryptoErrorCode =
  | 'prekey-missing' // first message used a one-time prekey we no longer have
  | 'session-conflict' // both sides started a session at once and ours won
  | 'no-session' // nothing to decrypt with, and the message can't start a session
  | 'bad-message'; // authentication failed / malformed

export interface CryptoError extends Error {
  code: CryptoErrorCode;
}

export function cryptoError(code: CryptoErrorCode, message: string): CryptoError {
  const e = new Error(message) as CryptoError;
  e.name = 'CryptoError';
  e.code = code;
  return e;
}

export function cryptoErrorCode(e: unknown): CryptoErrorCode | null {
  const code = (e as { code?: unknown } | null)?.code;
  return (e as { name?: string } | null)?.name === 'CryptoError' && typeof code === 'string'
    ? (code as CryptoErrorCode)
    : null;
}

export interface PreKeyListener {
  /** A one-time prekey was used up — delete its public half from the server. */
  consumed?: (id: number) => void;
  /** New one-time prekeys were generated — publish them. */
  replenished?: () => void;
}

export class SessionManager {
  private identity: LocalIdentity | null = null;
  private cache = new Map<string, StoredSession>();
  private locks = new Map<string, Promise<unknown>>();
  private listener: PreKeyListener = {};

  constructor(private readonly store: KeyStore) {}

  setPreKeyListener(listener: PreKeyListener): void {
    this.listener = listener;
  }

  /** Load (or create on first launch) this device's identity. */
  async init(): Promise<void> {
    let identity = await this.store.loadIdentity();
    if (!identity) {
      log.info('no identity found — generating a new one');
      identity = createIdentity();
      await this.store.saveIdentity(identity);
    } else if (identity.oneTimePreKeys.length < ONE_TIME_PREKEY_COUNT / 2) {
      log.info('replenishing one-time prekeys');
      identity = topUpOneTimePreKeys(identity);
      await this.store.saveIdentity(identity);
    }
    this.identity = identity;
    this.cache = new Map(Object.entries(await this.store.loadAllSessions()));
  }

  getIdentity(): LocalIdentity {
    if (!this.identity) throw new Error('SessionManager.init() has not run yet');
    return this.identity;
  }

  /** The public keys to publish to this user's Firestore document. */
  getPublicPreKeys() {
    return publicBundle(this.getIdentity());
  }

  hasSession(peerId: string): boolean {
    return this.cache.has(peerId);
  }

  /** The peer identity key (base64) this session was built against, if any. */
  sessionPeerIdentityKey(peerId: string): string | null {
    return this.cache.get(peerId)?.peerIdentityKey ?? null;
  }

  /** True while we've sent X3DH material the peer hasn't answered yet. */
  isAwaitingFirstReply(peerId: string): boolean {
    return !!this.cache.get(peerId)?.pendingEphemeralKey;
  }

  /** Forget a session so the next send starts a fresh handshake. */
  async resetSession(peerId: string): Promise<void> {
    return this.withLock(peerId, async () => {
      this.cache.delete(peerId);
      await this.store.deleteSession(peerId);
      log.info(`session with ${peerId} reset`);
    });
  }

  /** Safety number to compare out-of-band with a peer. */
  safetyNumberWithPeer(peerId: string): string {
    const session = this.cache.get(peerId);
    if (!session) throw new Error(`no session with ${peerId}`);
    return safetyNumber(this.getIdentity(), fromB64(session.peerIdentityKey));
  }

  private adFor(peerIdentityKey: Uint8Array): Uint8Array {
    const mine = this.getIdentity().identityKeyPair.publicKey;
    const [a, b] = b64(mine) < b64(peerIdentityKey) ? [mine, peerIdentityKey] : [peerIdentityKey, mine];
    return concatBytes(utf8ToBytes(AD_LABEL), a, b);
  }

  /**
   * Start a session as the initiator, using the peer's published bundle.
   * The bundle's one-time prekey is optional: without one X3DH runs on the
   * signed prekey alone (three DHs instead of four), which still authenticates
   * both sides — it just loses the one-time-prekey freshness bonus.
   *
   * Pass `replace: true` to discard an existing (broken or stale) session.
   */
  async createOutboundSession(
    peerId: string,
    bundle: RemotePreKeyBundle,
    opts: { replace?: boolean } = {},
  ): Promise<void> {
    return this.withLock(peerId, async () => {
      const existing = this.cache.get(peerId);
      if (existing && !opts.replace) return;

      const identity = this.getIdentity();
      const result = x3dhInitiate(identity.identityKeyPair, bundle);

      const ad = this.adFor(bundle.identityKey);
      const ratchet = DoubleRatchet.initInitiator(result.sharedSecret, bundle.signedPreKey, ad);

      const session: StoredSession = {
        peerId,
        peerIdentityKey: b64(bundle.identityKey),
        ratchet: ratchet.serialize(),
        isInitiator: true,
        pendingEphemeralKey: b64(result.ephemeralKey),
        pendingUsedPreKeyId: result.usedPreKeyId,
        peerEphemeralKey: null,
        handshakes: existing?.handshakes ?? [],
        createdAt: Date.now(),
      };
      await this.persist(session);
      log.info(`outbound session established with ${peerId}${result.usedPreKeyId == null ? ' (no one-time prekey)' : ''}`);
    });
  }

  /** Encrypt one plaintext for a peer, returning the wire payload. */
  async encrypt(peerId: string, plaintext: string): Promise<EncryptedPayload> {
    return this.withLock(peerId, async () => {
      const session = this.cache.get(peerId);
      if (!session) throw cryptoError('no-session', `no session with ${peerId} — call createOutboundSession first`);

      const ratchet = DoubleRatchet.deserialize(session.ratchet);
      const message = ratchet.encrypt(utf8ToBytes(plaintext));

      const header: CipherHeader = {
        ratchetKey: b64(message.header.ratchetKey),
        counter: message.header.counter,
        previousCounter: message.header.previousCounter,
        nonce: b64(message.nonce),
        // X3DH material stays on every message until the peer answers.
        ephemeralKey: session.pendingEphemeralKey,
        usedPreKeyId: session.pendingUsedPreKeyId,
      };

      await this.persist({ ...session, ratchet: ratchet.serialize() });
      return { ciphertext: b64(message.ciphertext), header };
    });
  }

  /**
   * Decrypt an incoming payload. `senderIdentityKey` must be the sender's
   * CURRENT published identity key (base64).
   *
   * Throws a CryptoError (see `cryptoErrorCode`) when the message can't be read.
   * State only changes when decryption succeeds.
   */
  async decrypt(peerId: string, senderIdentityKey: string, payload: EncryptedPayload): Promise<string> {
    return this.withLock(peerId, async () => {
      const existing = this.cache.get(peerId);
      const hs = payload.header.ephemeralKey ?? null;
      const known = existing?.handshakes ?? [];
      const identityChanged = !!existing && existing.peerIdentityKey !== senderIdentityKey;
      const isNewHandshake =
        !!hs && (!existing || identityChanged || (existing.peerEphemeralKey !== hs && !known.includes(hs)));

      // --- Normal path: the session we already have should decrypt this. -----
      if (existing && !identityChanged && !isNewHandshake) {
        return this.decryptWithExisting(existing, payload);
      }

      if (!isNewHandshake) {
        throw cryptoError(
          'no-session',
          identityChanged
            ? 'the sender\'s keys changed and this message does not start a new session'
            : 'no session yet and this message does not carry a handshake',
        );
      }

      // --- A new handshake. Resolve "glare" if we both started one at once. ---
      if (existing && !identityChanged && existing.isInitiator && existing.pendingEphemeralKey) {
        const mine = b64(this.getIdentity().identityKeyPair.publicKey);
        if (mine < senderIdentityKey) {
          throw cryptoError('session-conflict', 'both sides started a session; ours wins — the sender will adopt it');
        }
      }

      const { session: candidate, preKeyId } = this.buildInbound(peerId, senderIdentityKey, payload);
      const ratchet = DoubleRatchet.deserialize(candidate.ratchet);
      const plaintext = this.openWith(ratchet, payload);

      // Success — only now do we touch any state.
      const committed: StoredSession = {
        ...candidate,
        ratchet: ratchet.serialize(),
        handshakes: [...known, hs as string].slice(-MAX_REMEMBERED_HANDSHAKES),
      };
      await this.persist(committed);
      if (preKeyId != null) await this.consumePreKey(preKeyId);
      log.info(`inbound session established with ${peerId}`);
      return plaintext;
    });
  }

  private async decryptWithExisting(session: StoredSession, payload: EncryptedPayload): Promise<string> {
    const ratchet = DoubleRatchet.deserialize(session.ratchet);
    const plaintext = this.openWith(ratchet, payload);
    await this.persist({
      ...session,
      ratchet: ratchet.serialize(),
      // The peer answered, so they have our session — stop attaching X3DH material.
      pendingEphemeralKey: session.isInitiator ? null : session.pendingEphemeralKey,
      pendingUsedPreKeyId: session.isInitiator ? null : session.pendingUsedPreKeyId,
    });
    return plaintext;
  }

  private openWith(ratchet: DoubleRatchet, payload: EncryptedPayload): string {
    try {
      const plaintext = ratchet.decrypt({
        header: {
          ratchetKey: fromB64(payload.header.ratchetKey),
          counter: payload.header.counter,
          previousCounter: payload.header.previousCounter,
        },
        nonce: fromB64(payload.header.nonce),
        ciphertext: fromB64(payload.ciphertext),
      });
      return bytesToUtf8(plaintext);
    } catch (e) {
      throw cryptoError('bad-message', `could not decrypt: ${(e as Error).message}`);
    }
  }

  /** Build (but do NOT save) an inbound session from a handshake message. */
  private buildInbound(
    peerId: string,
    senderIdentityKey: string,
    payload: EncryptedPayload,
  ): { session: StoredSession; preKeyId: number | null } {
    const { ephemeralKey, usedPreKeyId } = payload.header;
    if (!ephemeralKey) {
      throw cryptoError('no-session', 'cannot bootstrap session: message is missing the X3DH ephemeral key');
    }

    const identity = this.getIdentity();
    const initiatorIdentityKey = fromB64(senderIdentityKey);

    let oneTimePreKey: KeyPair | null = null;
    if (usedPreKeyId != null) {
      const found = identity.oneTimePreKeys.find((k) => k.id === usedPreKeyId);
      if (!found) {
        // Used up, or from a previous install. Deriving without it would silently
        // produce a different secret, so fail loudly and let the sender retry.
        throw cryptoError('prekey-missing', `one-time prekey ${usedPreKeyId} is no longer available`);
      }
      oneTimePreKey = found.keyPair;
    }

    const sharedSecret = x3dhRespond(identity.identityKeyPair, identity.signedPreKey, oneTimePreKey, {
      initiatorIdentityKey,
      initiatorEphemeralKey: fromB64(ephemeralKey),
    });
    const ad = this.adFor(initiatorIdentityKey);
    const ratchet = DoubleRatchet.initResponder(sharedSecret, identity.signedPreKey, ad);

    return {
      preKeyId: usedPreKeyId ?? null,
      session: {
        peerId,
        peerIdentityKey: senderIdentityKey,
        ratchet: ratchet.serialize(),
        isInitiator: false,
        pendingEphemeralKey: null,
        pendingUsedPreKeyId: null,
        peerEphemeralKey: ephemeralKey,
        handshakes: [],
        createdAt: Date.now(),
      },
    };
  }

  private async consumePreKey(id: number): Promise<void> {
    await this.store.consumeOneTimePreKey(id);
    let identity = this.getIdentity();
    identity = { ...identity, oneTimePreKeys: identity.oneTimePreKeys.filter((k) => k.id !== id) };
    this.identity = identity;
    try {
      this.listener.consumed?.(id);
    } catch (e) {
      log.warn('prekey consumed listener failed', e);
    }
    if (identity.oneTimePreKeys.length < REPLENISH_BELOW) {
      this.identity = topUpOneTimePreKeys(identity);
      await this.store.saveIdentity(this.identity);
      try {
        this.listener.replenished?.();
      } catch (e) {
        log.warn('prekey replenished listener failed', e);
      }
    }
  }

  private async persist(session: StoredSession): Promise<void> {
    this.cache.set(session.peerId, session);
    await this.store.saveSession(session);
  }

  /** Serialise all crypto work for one peer so the ratchet stays consistent. */
  private withLock<T>(peerId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(peerId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    // Keep the chain alive even if `fn` rejects.
    this.locks.set(
      peerId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}
