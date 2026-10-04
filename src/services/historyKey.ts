/**
 * History key — lets you re-read the messages YOU sent after a reinstall.
 *
 * Why it exists: you can't decrypt your own outgoing envelopes (the ratchet that
 * made them belongs to the recipient), and a reinstall wipes the on-device
 * plaintext cache. So every message carries a second copy of its text sealed
 * with a random 32-byte history key. The server only ever sees that sealed blob.
 *
 * The history key itself is stored on the device (keychain). To survive a
 * reinstall it is ALSO stored in Firestore, wrapped (encrypted) with a key
 * derived from your account password via scrypt. After reinstalling you sign in
 * with the same password, the wrapped key is fetched and unwrapped, and your
 * sent history becomes readable again.
 *
 * Trade-offs, stated plainly:
 *  - The wrapped key is only as strong as your password (scrypt makes guessing
 *    slow, not impossible). A server operator who stole the wrapped key AND
 *    guessed your password could read the messages YOU sent. They can never read
 *    messages you received, and never your identity/ratchet keys.
 *  - If you reset a forgotten password you'll no longer be able to unwrap the
 *    old key, so old sent-history stays unreadable (new messages are unaffected;
 *    Settings offers "start a new backup").
 */

import * as Keychain from 'react-native-keychain';
import { scryptAsync } from '@noble/hashes/scrypt';
import { db } from './firebase';
import { b64, fromB64, randomBytes, seal, open } from './crypto/primitives';
import { utf8ToBytes, bytesToUtf8 } from '@/utils/bytes';
import type { SelfEnvelope } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('historyKey');
const SERVICE = 'com.sil.chatter.history';

// N=2^14 keeps a pure-JS scrypt under a few seconds on a mid-range phone; the
// parameters are stored with the wrapped key so they can be raised later.
const SCRYPT = { N: 2 ** 14, r: 8, p: 1, dkLen: 32 };

interface WrappedDoc {
  v: 1;
  salt: string;
  N: number;
  r: number;
  p: number;
  nonce: string;
  wrapped: string;
  createdAt: number;
}

const memory = new Map<string, Uint8Array>();

function ref(uid: string) {
  return db.collection('users').doc(uid).collection('backup').doc('history');
}

async function deriveKek(password: string, salt: Uint8Array, p: { N: number; r: number; p: number }): Promise<Uint8Array> {
  return scryptAsync(utf8ToBytes(password.normalize('NFKC')), salt, {
    N: p.N,
    r: p.r,
    p: p.p,
    dkLen: 32,
    asyncTick: 10,
  });
}

async function saveLocal(uid: string, key: Uint8Array): Promise<void> {
  memory.set(uid, key);
  await Keychain.setGenericPassword('history', b64(key), {
    service: `${SERVICE}.${uid}`,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

/** The history key for this account on this device, or null if not unlocked yet. */
export async function getHistoryKey(uid: string): Promise<Uint8Array | null> {
  const cached = memory.get(uid);
  if (cached) return cached;
  try {
    const stored = await Keychain.getGenericPassword({ service: `${SERVICE}.${uid}` });
    if (!stored) return null;
    const key = fromB64(stored.password);
    memory.set(uid, key);
    return key;
  } catch (e) {
    log.warn('could not read history key', e);
    return null;
  }
}

export type UnlockResult =
  | 'created' // first time: a new history key was made and backed up
  | 'restored' // an existing backup was unwrapped with this password
  | 'already' // this device already had the key
  | 'mismatch'; // a backup exists but this password can't open it (password was reset)

/**
 * Call right after a successful sign-in / sign-up while the password is in hand.
 * Never throws for a wrong-password-style mismatch; throws only on network errors.
 */
export async function unlockHistoryKey(uid: string, password: string): Promise<UnlockResult> {
  if (await getHistoryKey(uid)) return 'already';

  const snap = await ref(uid).get();
  if (snap.exists) {
    const d = snap.data() as WrappedDoc;
    const kek = await deriveKek(password, fromB64(d.salt), d);
    const key = open({ nonce: fromB64(d.nonce), ciphertext: fromB64(d.wrapped) }, kek);
    if (!key) {
      log.warn('history backup exists but this password cannot open it');
      return 'mismatch';
    }
    await saveLocal(uid, key);
    log.info('history key restored from backup');
    return 'restored';
  }
  await createBackup(uid, password);
  return 'created';
}

async function createBackup(uid: string, password: string): Promise<void> {
  const key = randomBytes(32);
  const salt = randomBytes(16);
  const kek = await deriveKek(password, salt, SCRYPT);
  const sealed = seal(key, kek);
  const doc: WrappedDoc = {
    v: 1,
    salt: b64(salt),
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    nonce: b64(sealed.nonce),
    wrapped: b64(sealed.ciphertext),
    createdAt: Date.now(),
  };
  await ref(uid).set(doc);
  await saveLocal(uid, key);
  log.info('new history key created and backed up');
}

/** Replace an unreadable backup with a fresh one (old sent-history stays unreadable). */
export async function startNewHistoryBackup(uid: string, password: string): Promise<void> {
  await createBackup(uid, password);
}

/** Seal message text with the history key. Returns null when there is no key yet. */
export async function sealForSelf(uid: string, text: string): Promise<SelfEnvelope | null> {
  const key = await getHistoryKey(uid);
  if (!key) return null;
  const sealed = seal(utf8ToBytes(text), key);
  return { nonce: b64(sealed.nonce), ciphertext: b64(sealed.ciphertext) };
}

/** Open a self-envelope. Returns null when there's no key or it doesn't match. */
export async function openSelfEnvelope(uid: string, env: SelfEnvelope): Promise<string | null> {
  const key = await getHistoryKey(uid);
  if (!key) return null;
  const plain = open({ nonce: fromB64(env.nonce), ciphertext: fromB64(env.ciphertext) }, key);
  return plain ? bytesToUtf8(plain) : null;
}

/** 'ready' if this device holds the key; otherwise the user must enter their password to unlock/create it. */
export async function historyKeyState(uid: string): Promise<'ready' | 'needs-password'> {
  return (await getHistoryKey(uid)) ? 'ready' : 'needs-password';
}

/** Forget the on-device key (sign-out). The server backup is untouched. */
export async function forgetLocalHistoryKey(uid: string): Promise<void> {
  memory.delete(uid);
  try {
    await Keychain.resetGenericPassword({ service: `${SERVICE}.${uid}` });
  } catch (e) {
    log.warn('could not clear history key', e);
  }
}
