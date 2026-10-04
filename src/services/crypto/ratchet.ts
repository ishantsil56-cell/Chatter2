/**
 * Double Ratchet.
 *
 * Once X3DH has produced a shared secret, the Double Ratchet keeps it evolving
 * so that:
 *   - every message uses a fresh single-use key (forward secrecy), and
 *   - a compromise today doesn't reveal yesterday's or tomorrow's messages
 *     (post-compromise security, via the DH ratchet).
 *
 * Two ratchets run together:
 *   - DH ratchet: on each turn, a new DH key pair is mixed into the root key.
 *   - Symmetric ratchet: within a chain, the chain key is hashed forward to
 *     produce a message key per message.
 *
 * Out-of-order and dropped messages are handled by caching the message keys of
 * skipped messages (bounded by MAX_SKIP to stop a hostile peer exhausting
 * memory).
 */

import {
  constantTimeEqual,
  concatBytes,
} from '@/utils/bytes';
import {
  b64,
  dh,
  fromB64,
  generateKeyPair,
  kdf,
  open,
  seal,
  ZERO_SALT,
  type KeyPair,
} from './primitives';

const ROOT_INFO = 'IRIS/DoubleRatchet/root/v1';
const CHAIN_INFO = 'IRIS/DoubleRatchet/chain/v1';
const AD_INFO = 'IRIS/DoubleRatchet/ad/v1';
const MAX_SKIP = 1000;

export interface RatchetHeader {
  ratchetKey: Uint8Array;
  counter: number;
  previousCounter: number;
}

export interface RatchetMessage {
  header: RatchetHeader;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/** KDF_RK: mix a DH output into the root key, producing a new root + chain key. */
function kdfRootKey(rootKey: Uint8Array, dhOut: Uint8Array): [Uint8Array, Uint8Array] {
  const out = kdf(dhOut, rootKey, ROOT_INFO, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

/** KDF_CK: advance a chain key, yielding the next chain key and a message key. */
function kdfChainKey(chainKey: Uint8Array): [Uint8Array, Uint8Array] {
  const out = kdf(chainKey, ZERO_SALT, CHAIN_INFO, 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}

function keyId(ratchetKey: Uint8Array, counter: number): string {
  return `${b64(ratchetKey)}:${counter}`;
}

export interface RatchetState {
  dhs: { publicKey: string; secretKey: string };
  dhr: string | null;
  rootKey: string;
  chainKeySend: string | null;
  chainKeyRecv: string | null;
  ns: number;
  nr: number;
  pn: number;
  skipped: { key: string; value: string }[];
  ad: string;
}

export class DoubleRatchet {
  private DHs: KeyPair;
  private DHr: Uint8Array | null;
  private RK: Uint8Array;
  private CKs: Uint8Array | null;
  private CKr: Uint8Array | null;
  private Ns: number;
  private Nr: number;
  private PN: number;
  private readonly skipped: Map<string, Uint8Array>;
  private readonly AD: Uint8Array;

  private constructor(args: {
    DHs: KeyPair;
    DHr: Uint8Array | null;
    RK: Uint8Array;
    CKs: Uint8Array | null;
    CKr: Uint8Array | null;
    Ns?: number;
    Nr?: number;
    PN?: number;
    skipped?: Map<string, Uint8Array>;
    AD: Uint8Array;
  }) {
    this.DHs = args.DHs;
    this.DHr = args.DHr;
    this.RK = args.RK;
    this.CKs = args.CKs;
    this.CKr = args.CKr;
    this.Ns = args.Ns ?? 0;
    this.Nr = args.Nr ?? 0;
    this.PN = args.PN ?? 0;
    this.skipped = args.skipped ?? new Map();
    this.AD = args.AD;
  }

  /** Initiator: Bob's ratchet key is his signed prekey. */
  static initInitiator(sharedSecret: Uint8Array, theirRatchetKey: Uint8Array, ad: Uint8Array): DoubleRatchet {
    const DHs = generateKeyPair();
    const [RK, CKs] = kdfRootKey(sharedSecret, dh(theirRatchetKey, DHs.secretKey));
    return new DoubleRatchet({ DHs, DHr: theirRatchetKey, RK, CKs, CKr: null, AD: ad });
  }

  /** Responder: uses its own signed prekey pair as the initial ratchet key. */
  static initResponder(sharedSecret: Uint8Array, myRatchetKey: KeyPair, ad: Uint8Array): DoubleRatchet {
    return new DoubleRatchet({ DHs: myRatchetKey, DHr: null, RK: sharedSecret, CKs: null, CKr: null, AD: ad });
  }

  /** Bind the associated data into the per-message key. */
  private messageKey(mk: Uint8Array): Uint8Array {
    return kdf(mk, this.AD, AD_INFO, 32);
  }

  encrypt(plaintext: Uint8Array): RatchetMessage {
    if (!this.CKs) throw new Error('DoubleRatchet: no sending chain (responder must receive first)');
    const [nextCK, mk] = kdfChainKey(this.CKs);
    this.CKs = nextCK;

    const header: RatchetHeader = {
      ratchetKey: this.DHs.publicKey,
      counter: this.Ns,
      previousCounter: this.PN,
    };
    this.Ns += 1;

    const sealed = seal(plaintext, this.messageKey(mk));
    return { header, nonce: sealed.nonce, ciphertext: sealed.ciphertext };
  }

  decrypt(message: RatchetMessage): Uint8Array {
    // 1. A cached key for a message we skipped earlier?
    const id = keyId(message.header.ratchetKey, message.header.counter);
    const cached = this.skipped.get(id);
    if (cached) {
      this.skipped.delete(id);
      return this.openOrThrow(message, cached);
    }

    // 2. A new ratchet key means the peer has ratcheted — advance our DH ratchet.
    if (!this.DHr || !constantTimeEqual(message.header.ratchetKey, this.DHr)) {
      this.skipMessageKeys(message.header.previousCounter);
      this.dhRatchet(message.header);
    }

    // 3. Skip any messages still missing in the current receiving chain.
    this.skipMessageKeys(message.header.counter);

    if (!this.CKr) throw new Error('DoubleRatchet: no receiving chain after ratchet');
    const [nextCK, mk] = kdfChainKey(this.CKr);
    this.CKr = nextCK;
    this.Nr += 1;
    return this.openOrThrow(message, mk);
  }

  private openOrThrow(message: RatchetMessage, mk: Uint8Array): Uint8Array {
    const plaintext = open(
      { nonce: message.nonce, ciphertext: message.ciphertext },
      this.messageKey(mk),
    );
    if (!plaintext) throw new Error('DoubleRatchet: authentication failed (bad key or tampered message)');
    return plaintext;
  }

  private dhRatchet(header: RatchetHeader): void {
    this.PN = this.Ns;
    this.Ns = 0;
    this.Nr = 0;
    this.DHr = header.ratchetKey;

    const [rk1, ckr] = kdfRootKey(this.RK, dh(this.DHr, this.DHs.secretKey));
    this.RK = rk1;
    this.CKr = ckr;

    this.DHs = generateKeyPair();
    const [rk2, cks] = kdfRootKey(this.RK, dh(this.DHr, this.DHs.secretKey));
    this.RK = rk2;
    this.CKs = cks;
  }

  private skipMessageKeys(until: number): void {
    if (until - this.Nr > MAX_SKIP) {
      throw new Error(`DoubleRatchet: refusing to skip more than ${MAX_SKIP} messages`);
    }
    if (!this.CKr || !this.DHr) return;
    while (this.Nr < until) {
      const [nextCK, mk] = kdfChainKey(this.CKr);
      this.CKr = nextCK;
      this.skipped.set(keyId(this.DHr, this.Nr), mk);
      this.Nr += 1;
    }
  }

  // --- Persistence ----------------------------------------------------------

  serialize(): RatchetState {
    return {
      dhs: { publicKey: b64(this.DHs.publicKey), secretKey: b64(this.DHs.secretKey) },
      dhr: this.DHr ? b64(this.DHr) : null,
      rootKey: b64(this.RK),
      chainKeySend: this.CKs ? b64(this.CKs) : null,
      chainKeyRecv: this.CKr ? b64(this.CKr) : null,
      ns: this.Ns,
      nr: this.Nr,
      pn: this.PN,
      skipped: Array.from(this.skipped.entries()).map(([key, value]) => ({ key, value: b64(value) })),
      ad: b64(this.AD),
    };
  }

  static deserialize(state: RatchetState): DoubleRatchet {
    return new DoubleRatchet({
      DHs: { publicKey: fromB64(state.dhs.publicKey), secretKey: fromB64(state.dhs.secretKey) },
      DHr: state.dhr ? fromB64(state.dhr) : null,
      RK: fromB64(state.rootKey),
      CKs: state.chainKeySend ? fromB64(state.chainKeySend) : null,
      CKr: state.chainKeyRecv ? fromB64(state.chainKeyRecv) : null,
      Ns: state.ns,
      Nr: state.nr,
      PN: state.pn,
      skipped: new Map(state.skipped.map((s) => [s.key, fromB64(s.value)])),
      AD: fromB64(state.ad),
    });
  }
}

export { concatBytes };
