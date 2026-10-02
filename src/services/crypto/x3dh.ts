/**
 * X3DH ("Extended Triple Diffie-Hellman") key agreement.
 *
 * This is the same handshake Signal uses to bootstrap a session between two
 * parties who have never talked before. It combines a long-term identity key
 * with a signed prekey and (optionally) a one-time prekey to produce a shared
 * secret that is authenticated, forward-secret, and resistant to replay.
 *
 * Roles:
 *   - Bob (responder) publishes a PreKeyBundle: identity key, a signed prekey
 *     and a batch of one-time prekeys. The signed prekey is signed with Bob's
 *     Ed25519 signing key so Alice can be sure it really belongs to him.
 *   - Alice (initiator) fetches the bundle, verifies the signature, generates an
 *     ephemeral key, and performs four DH operations.
 *
 * The shared secret `SK` feeds straight into the Double Ratchet (./ratchet.ts).
 */

import {
  dh,
  generateKeyPair,
  kdf,
  sign,
  verify,
  ZERO_SALT,
  type KeyPair,
  type SigningKeyPair,
} from './primitives';
import { concatBytes } from '@/utils/bytes';

const X3DH_INFO = 'Chatter/X3DH/v1';
const F_PREFIX = new Uint8Array(32).fill(0xff);

/** A one-time prekey the owner has published. */
export interface PublicOneTimePreKey {
  id: number;
  publicKey: Uint8Array;
}

/** What a user publishes so others can start sessions with them. */
export interface PreKeyBundle {
  identityKey: Uint8Array; // X25519 public
  signingKey: Uint8Array; // Ed25519 public
  signedPreKey: Uint8Array; // X25519 public
  signedPreKeySignature: Uint8Array; // Ed25519 signature over signedPreKey
  signedPreKeyId: number;
  oneTimePreKeys: PublicOneTimePreKey[];
}

/** The subset an initiator actually picks from a bundle. */
export interface RemotePreKeyBundle {
  identityKey: Uint8Array;
  signingKey: Uint8Array;
  signedPreKey: Uint8Array;
  signedPreKeySignature: Uint8Array;
  signedPreKeyId: number;
  oneTimePreKey?: PublicOneTimePreKey;
}

export interface X3DHInitResult {
  /** The shared secret to initialise the Double Ratchet with. */
  sharedSecret: Uint8Array;
  /** Ephemeral public key the responder needs to redo the DHs. */
  ephemeralKey: Uint8Array;
  /** Id of the one-time prekey that was consumed, if any. */
  usedPreKeyId: number | null;
}

export interface X3DHRespondInput {
  initiatorIdentityKey: Uint8Array;
  initiatorEphemeralKey: Uint8Array;
}

/**
 * Initiator side. `ephemeral` may be passed in for deterministic tests.
 */
export function x3dhInitiate(
  myIdentity: KeyPair,
  theirBundle: RemotePreKeyBundle,
  ephemeral: KeyPair = generateKeyPair(),
): X3DHInitResult {
  // 1. Authenticate the signed prekey before trusting it.
  if (!verify(theirBundle.signedPreKey, theirBundle.signedPreKeySignature, theirBundle.signingKey)) {
    throw new Error('X3DH: signed prekey signature is invalid — refusing to start session');
  }

  // 2. Four Diffie-Hellman operations.
  const dh1 = dh(theirBundle.signedPreKey, myIdentity.secretKey); // IK_A ↔ SPK_B
  const dh2 = dh(theirBundle.identityKey, ephemeral.secretKey); // EK_A ↔ IK_B
  const dh3 = dh(theirBundle.signedPreKey, ephemeral.secretKey); // EK_A ↔ SPK_B
  const parts = [dh1, dh2, dh3];
  let usedPreKeyId: number | null = null;
  if (theirBundle.oneTimePreKey) {
    const dh4 = dh(theirBundle.oneTimePreKey.publicKey, ephemeral.secretKey); // EK_A ↔ OPK_B
    parts.push(dh4);
    usedPreKeyId = theirBundle.oneTimePreKey.id;
  }

  const f = concatBytes(F_PREFIX, ...parts);
  const sharedSecret = kdf(f, ZERO_SALT, X3DH_INFO, 32);
  return { sharedSecret, ephemeralKey: ephemeral.publicKey, usedPreKeyId };
}

/**
 * Responder side. Bob recomputes the same four DHs from his private keys and
 * the initiator's public identity + ephemeral keys.
 */
export function x3dhRespond(
  myIdentity: KeyPair,
  mySignedPreKey: KeyPair,
  myOneTimePreKey: KeyPair | null,
  input: X3DHRespondInput,
): Uint8Array {
  const dh1 = dh(input.initiatorIdentityKey, mySignedPreKey.secretKey); // SPK_B ↔ IK_A
  const dh2 = dh(input.initiatorEphemeralKey, myIdentity.secretKey); // IK_B ↔ EK_A
  const dh3 = dh(input.initiatorEphemeralKey, mySignedPreKey.secretKey); // SPK_B ↔ EK_A
  const parts = [dh1, dh2, dh3];
  if (myOneTimePreKey) {
    const dh4 = dh(input.initiatorEphemeralKey, myOneTimePreKey.secretKey); // OPK_B ↔ EK_A
    parts.push(dh4);
  }
  const f = concatBytes(F_PREFIX, ...parts);
  return kdf(f, ZERO_SALT, X3DH_INFO, 32);
}

/** Sign a freshly generated signed prekey with the Ed25519 signing key. */
export function signPreKey(signedPreKey: KeyPair, signingKey: SigningKeyPair): Uint8Array {
  return sign(signedPreKey.publicKey, signingKey.secretKey);
}
