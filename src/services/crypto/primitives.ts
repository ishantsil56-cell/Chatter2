/**
 * Low-level cryptographic primitives for the E2EE layer.
 *
 * Everything here is built on two well-reviewed, pure-JavaScript libraries so it
 * runs identically in React Native (Hermes), Node (tests) and Cloud Functions:
 *
 *   tweetnacl      — Curve25519 (X25519) Diffie-Hellman, Ed25519 signatures,
 *                    XSalsa20-Poly1305 authenticated encryption, CSPRNG.
 *   @noble/hashes  — SHA-256 and HKDF-SHA256 for key derivation.
 *
 * This file deliberately exposes only *primitive* operations. The protocol
 * (X3DH + Double Ratchet) is built on top of them in ./x3dh.ts and ./ratchet.ts.
 */

import * as nacl from 'tweetnacl';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { base64ToBytes, bytesToBase64, concatBytes, utf8ToBytes } from '@/utils/bytes';

export const KEY_BYTES = 32; // Curve25519 / Ed25519 keys and outputs
export const NONCE_BYTES = 24; // XSalsa20-Poly1305 nonce
export const MAC_BYTES = 16; // Poly1305 tag

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface SigningKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

// --- Randomness ---------------------------------------------------------------

export function randomBytes(n: number): Uint8Array {
  return nacl.randomBytes(n);
}

// --- Key generation -----------------------------------------------------------

/** Curve25519 key pair, used for Diffie-Hellman (identity, prekeys, ratchet). */
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/** Ed25519 key pair, used to sign prekeys so peers can authenticate them. */
export function generateSigningKeyPair(): SigningKeyPair {
  const kp = nacl.sign.keyPair();
  return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

// --- Diffie-Hellman -----------------------------------------------------------

/**
 * X25519 Diffie-Hellman. `nacl.box.before` returns the raw 32-byte shared
 * secret (the same value the peer computes with swapped arguments).
 */
export function dh(theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array {
  return nacl.box.before(theirPublicKey, mySecretKey);
}

// --- Signatures ---------------------------------------------------------------

export function sign(message: Uint8Array, signingSecretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, signingSecretKey);
}

export function verify(
  message: Uint8Array,
  signature: Uint8Array,
  signingPublicKey: Uint8Array,
): boolean {
  return nacl.sign.detached.verify(message, signature, signingPublicKey);
}

// --- Key derivation (HKDF-SHA256) ---------------------------------------------

const ZERO_SALT = new Uint8Array(32);

/** HKDF-SHA256 with an explicit salt/info. Output length must be ≤ 255*32. */
export function kdf(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number,
): Uint8Array {
  return hkdf(sha256, inputKeyMaterial, salt, utf8ToBytes(info), length);
}

/** Split a byte string into two 32-byte halves (root key / chain key). */
export function splitKeyPair(input: Uint8Array): [Uint8Array, Uint8Array] {
  if (input.length < 64) throw new Error('splitKeyPair: need at least 64 bytes');
  return [input.slice(0, 32), input.slice(32, 64)];
}

export { ZERO_SALT };

// --- Authenticated encryption (XSalsa20-Poly1305) -----------------------------

export interface Sealed {
  nonce: Uint8Array;
  ciphertext: Uint8Array; // includes the 16-byte Poly1305 tag
}

/**
 * Encrypt with a symmetric message key. The nonce is random and returned
 * alongside — message keys are single-use, so nonce reuse is not a concern.
 */
export function seal(plaintext: Uint8Array, key: Uint8Array): Sealed {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);
  return { nonce, ciphertext };
}

/** Decrypt; returns null if authentication fails (wrong key or tampered data). */
export function open(sealed: Sealed, key: Uint8Array): Uint8Array | null {
  return nacl.secretbox.open(sealed.ciphertext, sealed.nonce, key);
}

// --- Hashing ------------------------------------------------------------------

export function hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export function sha256Hex(data: Uint8Array): string {
  return Array.from(sha256(data))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- Encoding helpers used across the crypto layer ----------------------------

export function b64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function fromB64(s: string): Uint8Array {
  return base64ToBytes(s);
}

/** Fingerprint of an identity key, shown to users for out-of-band verification. */
export function fingerprint(identityKey: Uint8Array): string {
  const hex = sha256Hex(identityKey).slice(0, 40).toUpperCase();
  return (hex.match(/.{1,5}/g) ?? []).join(' ');
}

export { concatBytes };
