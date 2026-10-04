/**
 * Prekey publication and retrieval — Spark-plan friendly (no Cloud Functions).
 *
 * Publishing: the public bundle goes on the user document; one-time prekeys go
 * into users/{uid}/prekeys/{keyId}. The server copy is kept in step with the
 * device: when a key is used up (or a reinstall replaces them all) the stale
 * public halves are deleted, so nobody is handed a key we can no longer use.
 *
 * Retrieving a peer's bundle: a plain read. Without a server-side function we
 * can't atomically "take" a one-time prekey, so the sender picks one at random
 * from the pool (collisions are rare) and the owner deletes it once consumed.
 * If a collision or a stale key still breaks a first message, the recipient
 * asks for a resend and the sender retries WITHOUT a one-time prekey (X3DH on
 * the signed prekey alone), which can't collide — see services/resend.ts.
 */

import { db } from './firebase';
import { b64, fromB64 } from './crypto/primitives';
import type { RemotePreKeyBundle } from './crypto/x3dh';
import type { LocalIdentity } from './crypto/identity';
import { UserError } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('prekeys');
const ONE_TIME_PREKEYS = 'prekeys';
const POOL_SAMPLE = 25;

/** Publish (or refresh) this user's public bundle and sync the one-time prekey pool. */
export async function publishPreKeys(uid: string, identity: LocalIdentity): Promise<void> {
  const userRef = db.collection('users').doc(uid);
  const pool = userRef.collection(ONE_TIME_PREKEYS);

  // Which published keys are no longer usable (consumed, or from an old install)?
  const localIds = new Set(identity.oneTimePreKeys.map((k) => String(k.id)));
  let stale: string[] = [];
  try {
    const existing = await pool.get();
    stale = existing.docs.map((d) => d.id).filter((id) => !localIds.has(id));
  } catch (e) {
    log.warn('could not list published prekeys; skipping cleanup', e);
  }

  const batch = db.batch();
  batch.set(
    userRef,
    {
      identityKey: b64(identity.identityKeyPair.publicKey),
      signingKey: b64(identity.signingKeyPair.publicKey),
      signedPreKey: b64(identity.signedPreKey.publicKey),
      signedPreKeySignature: b64(identity.signedPreKeySignature),
      preKeyId: identity.signedPreKeyId,
      updatedAt: Date.now(),
    },
    { merge: true },
  );
  for (const otpk of identity.oneTimePreKeys) {
    batch.set(pool.doc(String(otpk.id)), { id: otpk.id, publicKey: b64(otpk.keyPair.publicKey) });
  }
  for (const id of stale) batch.delete(pool.doc(id));

  await batch.commit();
  log.info(`published ${identity.oneTimePreKeys.length} one-time prekeys, removed ${stale.length} stale`);
}

/** Remove one consumed one-time prekey from the server. */
export async function deletePublishedPreKey(uid: string, id: number): Promise<void> {
  await db.collection('users').doc(uid).collection(ONE_TIME_PREKEYS).doc(String(id)).delete();
}

export interface FetchedBundle {
  bundle: RemotePreKeyBundle;
  /** Peer identity key (base64) — also what we cache for decrypting and safety numbers. */
  identityKey: string;
}

export interface FetchOptions {
  /** Skip the one-time prekey and use the signed prekey alone. */
  withoutOneTimePreKey?: boolean;
}

/** Read a peer's bundle, picking a random one-time prekey if any are published. */
export async function fetchPeerBundle(peerId: string, opts: FetchOptions = {}): Promise<FetchedBundle> {
  const userRef = db.collection('users').doc(peerId);
  const snap = await userRef.get();
  if (!snap.exists) throw new Error(`no such user: ${peerId}`);
  const d = snap.data() ?? {};
  if (!d.identityKey || !d.signedPreKey || !d.signedPreKeySignature) {
    throw new UserError('That person hasn’t finished setting up yet.');
  }

  let chosen: { id: number; publicKey: string } | undefined;
  if (!opts.withoutOneTimePreKey) {
    try {
      const pool = await userRef.collection(ONE_TIME_PREKEYS).limit(POOL_SAMPLE).get();
      const docs = pool.docs;
      if (docs.length > 0) {
        chosen = docs[Math.floor(Math.random() * docs.length)]?.data() as { id: number; publicKey: string } | undefined;
      }
    } catch (e) {
      log.warn('could not read one-time prekeys; continuing with the signed prekey only', e);
    }
  }

  return {
    identityKey: d.identityKey as string,
    bundle: {
      identityKey: fromB64(d.identityKey),
      signingKey: fromB64(d.signingKey ?? d.identityKey),
      signedPreKey: fromB64(d.signedPreKey),
      signedPreKeySignature: fromB64(d.signedPreKeySignature),
      signedPreKeyId: d.preKeyId ?? 1,
      oneTimePreKey: chosen ? { id: chosen.id, publicKey: fromB64(chosen.publicKey) } : undefined,
    },
  };
}

/** A peer's currently published identity key, or null if we can't reach the server. */
export async function fetchPeerIdentityKey(peerId: string): Promise<string | null> {
  try {
    const snap = await db.collection('users').doc(peerId).get();
    const key = snap.data()?.identityKey;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}
