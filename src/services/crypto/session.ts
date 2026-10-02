/**
 * SessionManager — the public face of the E2EE layer.
 *
 * It ties together identity/prekeys (./identity.ts), the X3DH handshake
 * (./x3dh.ts) and the Double Ratchet (./ratchet.ts), and exposes the two calls
 * the rest of the app actually needs:
 *
 *   await crypto.encrypt(peerId, "hello")   -> { ciphertext, header }
 *   await crypto.decrypt(peerId, payload)   -> "hello"
 *
 * Wire format (`EncryptedPayload`) maps 1:1 onto the `ciphertext` +
 * `cipherHeader` fields of a Firestore message.
 *
 * All operations for a given peer are serialised through a per-peer lock, so a
 * burst of concurrent messages can't corrupt the ratchet state.
 */

import { b64, fromB64, type KeyPair } from './primitives';
import { concatBytes } from '@/utils/bytes';
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
const AD_LABEL = 'ChatterSessionV1';

export interface EncryptedPayload {
  ciphertext: string;
  header: CipherHeader;
}

export class SessionManager {
  private identity: LocalIdentity | null = null;
  private cache = new Map<string, StoredSession>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(private readonly store: KeyStore) {}

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

  /** Safety number to compare out-of-band with a peer. */
  safetyNumberWithPeer(peerId: string): string {
    const session = this.cache.get(peerId);
    if (!session) throw new Error(`no session with ${peerId}`);
    return safetyNumber(this.getIdentity(), fromB64(session.peerIdentityKey));
  }

  private adFor(peerIdentityKey: Uint8Array): Uint8Array {
    const mine = this.getIdentity().identityKeyPair.publicKey;
    const [a, b] = b64(mine) < b64(peerIdentityKey) ? [mine, peerIdentityKey] : [peerIdentityKey, mine];
    return concatBytes(new TextEncoder().encode(AD_LABEL), a, b);
  }

  /**
   * Start a session as the initiator, using the peer's published bundle.
   * Call this the first time you message someone.
   */
  async createOutboundSession(peerId: string, bundle: RemotePreKeyBundle): Promise<void> {
    return this.withLock(peerId, async () => {
      if (this.cache.has(peerId)) return;

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
        createdAt: Date.now(),
      };
      await this.persist(session);
      log.info(`outbound session established with ${peerId}`);
    });
  }

  /** Encrypt one plaintext for a peer, returning the wire payload. */
  async encrypt(peerId: string, plaintext: string): Promise<EncryptedPayload> {
    return this.withLock(peerId, async () => {
      const session = this.cache.get(peerId);
      if (!session) throw new Error(`no session with ${peerId} — call createOutboundSession first`);

      const ratchet = DoubleRatchet.deserialize(session.ratchet);
      const message = ratchet.encrypt(new TextEncoder().encode(plaintext));

      const header: CipherHeader = {
        ratchetKey: b64(message.header.ratchetKey),
        counter: message.header.counter,
        previousCounter: message.header.previousCounter,
        nonce: b64(message.nonce),
        // The X3DH material rides only on the very first message.
        ephemeralKey: session.pendingEphemeralKey,
        usedPreKeyId: session.pendingUsedPreKeyId,
      };

      const updated: StoredSession = {
        ...session,
        ratchet: ratchet.serialize(),
        pendingEphemeralKey: null,
        pendingUsedPreKeyId: null,
      };
      await this.persist(updated);

      return { ciphertext: b64(message.ciphertext), header };
    });
  }

  /**
   * Decrypt an incoming payload. If no session exists yet, bootstrap one from
   * the X3DH material carried in the first message.
   */
  async decrypt(
    peerId: string,
    senderIdentityKey: string,
    payload: EncryptedPayload,
  ): Promise<string> {
    return this.withLock(peerId, async () => {
      let session = this.cache.get(peerId);

      if (!session) {
        session = await this.bootstrapInbound(peerId, senderIdentityKey, payload);
      }

      const ratchet = DoubleRatchet.deserialize(session.ratchet);
      let plaintext: Uint8Array;
      try {
        plaintext = ratchet.decrypt({
          header: {
            ratchetKey: fromB64(payload.header.ratchetKey),
            counter: payload.header.counter,
            previousCounter: payload.header.previousCounter,
          },
          nonce: fromB64(payload.header.nonce),
          ciphertext: fromB64(payload.ciphertext),
        });
      } catch (e) {
        // A duplicate/replayed message will fail to decrypt; that's expected.
        log.warn(`decrypt failed from ${peerId}: ${(e as Error).message}`);
        throw e;
      }

      await this.persist({ ...session, ratchet: ratchet.serialize() });
      return new TextDecoder().decode(plaintext);
    });
  }

  private async bootstrapInbound(
    peerId: string,
    senderIdentityKey: string,
    payload: EncryptedPayload,
  ): Promise<StoredSession> {
    const { ephemeralKey, usedPreKeyId } = payload.header;
    if (!ephemeralKey) {
      throw new Error('cannot bootstrap session: first message is missing the X3DH ephemeral key');
    }

    const identity = this.getIdentity();
    const initiatorIdentityKey = fromB64(senderIdentityKey);

    let oneTimePreKey: KeyPair | null = null;
    if (usedPreKeyId != null) {
      const found = identity.oneTimePreKeys.find((k) => k.id === usedPreKeyId);
      if (found) {
        oneTimePreKey = found.keyPair;
        await this.store.consumeOneTimePreKey(usedPreKeyId);
        identity.oneTimePreKeys = identity.oneTimePreKeys.filter((k) => k.id !== usedPreKeyId);
      }
    }

    const sharedSecret = x3dhRespond(
      identity.identityKeyPair,
      identity.signedPreKey,
      oneTimePreKey,
      { initiatorIdentityKey, initiatorEphemeralKey: fromB64(ephemeralKey) },
    );

    const ad = this.adFor(initiatorIdentityKey);
    const ratchet = DoubleRatchet.initResponder(sharedSecret, identity.signedPreKey, ad);

    const session: StoredSession = {
      peerId,
      peerIdentityKey: b64(initiatorIdentityKey),
      ratchet: ratchet.serialize(),
      isInitiator: false,
      pendingEphemeralKey: null,
      pendingUsedPreKeyId: null,
      createdAt: Date.now(),
    };
    await this.persist(session);
    log.info(`inbound session established with ${peerId}`);
    return session;
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
