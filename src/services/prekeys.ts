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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { db } from './firebase';
import { b64, fromB64 } from './crypto/primitives';
import type { RemotePreKeyBundle } from './crypto/x3dh';
import type { LocalIdentity } from './crypto/identity';
import { UserError } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('prekeys');
const ONE_TIME_PREKEYS = 'prekeys';
const POOL_SAMPLE = 25;

/**
 * Local record of what we last published, so a normal sign-in doesn't re-upload
 * 50 documents. Keyed by uid because a device can host more than one account.
 */
function publishedMarkerKey(uid: string): string {
  return `chatter.prekeys.published.v1.${uid}`;
}

/** Everything about the identity that must be reflected on the server. */
function identitySignature(identity: LocalIdentity): string {
  const ids = identity.oneTimePreKeys.map((k) => k.id).sort((a, b) => a - b);
  return [
    b64(identity.identityKeyPair.publicKey),
    b64(identity.signingKeyPair.publicKey),
    String(identity.signedPreKeyId),
    ids.join(','),
  ].join('|');
}

/**
 * Publish (or refresh) this user's public bundle and sync the one-time prekey pool.
 *
 * Fast path: if this device already published exactly this identity, we return
 * immediately — no reads, no writes. That's what makes sign-in quick, since the
 * naive version rewrote all 50 prekeys on every single login.
 *
 * Otherwise we reconcile against the server and write only the difference:
 * add keys the server is missing, delete keys we can no longer use.
 */
export async function publishPreKeys(uid: string, identity: LocalIdentity, opts?: { force?: boolean }): Promise<void> {
  const userRef = db.collection('users').doc(uid);
  const pool = userRef.collection(ONE_TIME_PREKEYS);
  const signature = identitySignature(identity);

  if (!opts?.force) {
    try {
      if ((await AsyncStorage.getItem(publishedMarkerKey(uid))) === signature) {
        log.debug('prekeys already published for this identity; skipping');
        return;
      }
    } catch (e) {
      log.warn('could not read prekey marker; reconciling', e);
    }
  }

  // Which published keys are no longer usable (consumed, or from an old install)?
  const localIds = new Set(identity.oneTimePreKeys.map((k) => String(k.id)));
  let publishedIds: string[] = [];
  try {
    publishedIds = (await pool.get()).docs.map((d) => d.id);
  } catch (e) {
    log.warn('could not list published prekeys; will (re)publish all', e);
  }

  const published = new Set(publishedIds);
  const toAdd = identity.oneTimePreKeys.filter((k) => !published.has(String(k.id)));
  const toDelete = publishedIds.filter((id) => !localIds.has(id));

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
  for (const otpk of toAdd) {
    batch.set(pool.doc(String(otpk.id)), { id: otpk.id, publicKey: b64(otpk.keyPair.publicKey) });
  }
  for (const id of toDelete) batch.delete(pool.doc(id));

  await batch.commit();
  try {
    await AsyncStorage.setItem(publishedMarkerKey(uid), signature);
  } catch (e) {
    log.warn('could not store prekey marker', e);
  }
  log.info(`prekeys synced: +${toAdd.length} added, -${toDelete.length} removed`);
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
