/**
 * Long-term identity and the prekeys a user publishes.
 *
 * A user owns:
 *   - an identity key pair (Curve25519) — their stable DH identity,
 *   - a signing key pair (Ed25519) — used to authenticate the signed prekey,
 *   - a signed prekey — rotated periodically, signed by the identity,
 *   - a batch of one-time prekeys — each consumed by exactly one session.
 *
 * Only the *public* halves ever leave the device (they go into the user's
 * Firestore document). Private halves live in the device keychain.
 */

import {
  b64,
  fingerprint,
  generateKeyPair,
  generateSigningKeyPair,
  sign,
  verify,
  type KeyPair,
  type SigningKeyPair,
} from './primitives';
import { fromB64 } from './primitives';
import { signPreKey, type PreKeyBundle } from './x3dh';

export interface OneTimePreKey {
  id: number;
  keyPair: KeyPair;
}

export interface LocalIdentity {
  identityKeyPair: KeyPair;
  signingKeyPair: SigningKeyPair;
  signedPreKey: KeyPair;
  signedPreKeyId: number;
  signedPreKeySignature: Uint8Array;
  oneTimePreKeys: OneTimePreKey[];
  /** Next unused one-time prekey id. */
  nextPreKeyId: number;
  createdAt: number;

  /** When the current signed prekey was generated. Absent on older installs. */
  signedPreKeyCreatedAt?: number;
  /**
   * Superseded signed prekeys, kept so a session started against the old one
   * still decrypts. Bounded; see MAX_RETIRED_SIGNED.
   */
  retiredSignedPreKeys?: { id: number; keyPair: KeyPair; retiredAt: number }[];
  /**
   * One-time prekeys already consumed, kept briefly. Fetching a bundle and
   * consuming the key are not atomic, so two senders can be handed the same one;
   * without this the second sender's messages would be undecryptable.
   */
  retiredOneTimePreKeys?: { id: number; keyPair: KeyPair; retiredAt: number }[];
}

export const ONE_TIME_PREKEY_COUNT = 50;
export const SIGNED_PREKEY_ID = 1;

/** Rotate the signed prekey roughly weekly, as Signal does. */
export const SIGNED_PREKEY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** How many superseded signed prekeys to keep for in-flight sessions. */
export const MAX_RETIRED_SIGNED = 2;
/** How many consumed one-time prekeys to keep for duplicate bundle fetches. */
export const MAX_RETIRED_OTPK = 20;

/**
 * Rotate the signed prekey if it has aged out.
 *
 * A signed prekey that lives as long as the identity means one compromise
 * exposes far more history than the protocol intends, and it weakens the
 * post-compromise recovery the DH ratchet is meant to give. The old key is kept
 * in `retiredSignedPreKeys` so sessions already started against it keep working
 * — the responder simply tries each candidate in turn.
 */
export function rotateSignedPreKeyIfDue(identity: LocalIdentity): LocalIdentity {
  const created = identity.signedPreKeyCreatedAt ?? identity.createdAt;
  if (Date.now() - created < SIGNED_PREKEY_MAX_AGE_MS) return identity;

  const signedPreKey = generateKeyPair();
  const signedPreKeySignature = signPreKey(signedPreKey, identity.signingKeyPair);
  const retired = [
    { id: identity.signedPreKeyId, keyPair: identity.signedPreKey, retiredAt: Date.now() },
    ...(identity.retiredSignedPreKeys ?? []),
  ].slice(0, MAX_RETIRED_SIGNED);

  return {
    ...identity,
    signedPreKey,
    signedPreKeyId: identity.signedPreKeyId + 1,
    signedPreKeySignature,
    signedPreKeyCreatedAt: Date.now(),
    retiredSignedPreKeys: retired,
  };
}

/** Move a consumed one-time prekey to the retired list instead of dropping it. */
export function retireOneTimePreKey(identity: LocalIdentity, id: number): LocalIdentity {
  const found = identity.oneTimePreKeys.find((k) => k.id === id);
  if (!found) return identity;
  const retired = [
    { id, keyPair: found.keyPair, retiredAt: Date.now() },
    ...(identity.retiredOneTimePreKeys ?? []),
  ].slice(0, MAX_RETIRED_OTPK);
  return { ...identity, retiredOneTimePreKeys: retired };
}

/** Generate a brand-new identity from scratch (first launch). */
export function createIdentity(): LocalIdentity {
  const identityKeyPair = generateKeyPair();
  const signingKeyPair = generateSigningKeyPair();
  const signedPreKey = generateKeyPair();
  const signedPreKeySignature = signPreKey(signedPreKey, signingKeyPair);
  const oneTimePreKeys: OneTimePreKey[] = [];
  for (let id = 1; id <= ONE_TIME_PREKEY_COUNT; id++) {
    oneTimePreKeys.push({ id, keyPair: generateKeyPair() });
  }
  return {
    identityKeyPair,
    signingKeyPair,
    signedPreKey,
    signedPreKeyId: SIGNED_PREKEY_ID,
    signedPreKeySignature,
    oneTimePreKeys,
    nextPreKeyId: ONE_TIME_PREKEY_COUNT + 1,
    createdAt: Date.now(),
  };
}

/** Replenish one-time prekeys once the pool runs low. */
export function topUpOneTimePreKeys(identity: LocalIdentity, target: number = ONE_TIME_PREKEY_COUNT): LocalIdentity {
  const oneTimePreKeys = [...identity.oneTimePreKeys];
  let nextPreKeyId = identity.nextPreKeyId;
  while (oneTimePreKeys.length < target) {
    oneTimePreKeys.push({ id: nextPreKeyId, keyPair: generateKeyPair() });
    nextPreKeyId += 1;
  }
  return { ...identity, oneTimePreKeys, nextPreKeyId };
}

/**
 * Build the public bundle to publish to Firestore. The one-time prekeys are
 * returned separately because they live in a subcollection (each consumed key
 * is deleted individually so it can never be reused).
 */
export function publicBundle(identity: LocalIdentity): {
  bundle: Omit<PreKeyBundle, 'oneTimePreKeys'>;
  oneTimePreKeys: { id: number; publicKey: string }[];
} {
  return {
    bundle: {
      identityKey: identity.identityKeyPair.publicKey,
      signingKey: identity.signingKeyPair.publicKey,
      signedPreKey: identity.signedPreKey.publicKey,
      signedPreKeySignature: identity.signedPreKeySignature,
      signedPreKeyId: identity.signedPreKeyId,
    },
    oneTimePreKeys: identity.oneTimePreKeys.map((k) => ({ id: k.id, publicKey: b64(k.keyPair.publicKey) })),
  };
}

/** The safety number two users can compare out-of-band to defeat MITM. */
export function safetyNumber(myIdentity: LocalIdentity, theirIdentityKey: Uint8Array): string {
  const a = myIdentity.identityKeyPair.publicKey;
  const b = theirIdentityKey;
  // Order-independent so both users see the same number.
  const ordered = b64(a) < b64(b) ? [a, b] : [b, a];
  const combined = new Uint8Array([...ordered[0], ...ordered[1]]);
  return fingerprint(combined);
}

/** Verify a published signed prekey (used when fetching a peer's bundle). */
export function verifySignedPreKey(signedPreKey: string, signature: string, signingKey: string): boolean {
  return verify(fromB64(signedPreKey), fromB64(signature), fromB64(signingKey));
}

export { sign };
