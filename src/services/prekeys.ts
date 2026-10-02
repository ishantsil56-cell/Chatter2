/**
 * Prekey publication and retrieval.
 *
 * Publishing: the public bundle goes on the user document; one-time prekeys go
 * into users/{uid}/prekeys/{keyId} so each can be deleted individually once
 * consumed (guaranteeing single use).
 *
 * Retrieving a peer's bundle: we call the `fetchPreKeyBundle` Cloud Function,
 * which returns the bundle plus one one-time prekey and deletes that prekey
 * server-side in the same transaction. A client can't delete another user's
 * prekey (security rules forbid it), which is exactly why this is a function.
 */

import { db, functions } from './firebase';
import { b64 } from './crypto/primitives';
import type { RemotePreKeyBundle } from './crypto/x3dh';
import type { LocalIdentity } from './crypto/identity';
import { scope } from '@/utils/logger';

const log = scope('prekeys');
const ONE_TIME_PREKEYS = 'prekeys';

/** Publish (or refresh) this user's public bundle + one-time prekeys. */
export async function publishPreKeys(uid: string, identity: LocalIdentity): Promise<void> {
  const batch = db.batch();
  const userRef = db.collection('users').doc(uid);

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
    const ref = userRef.collection(ONE_TIME_PREKEYS).doc(String(otpk.id));
    batch.set(ref, { id: otpk.id, publicKey: b64(otpk.keyPair.publicKey) });
  }

  await batch.commit();
  log.info(`published ${identity.oneTimePreKeys.length} one-time prekeys for ${uid}`);
}

export interface FetchedBundle {
  bundle: RemotePreKeyBundle;
  /** Peer identity key (base64) — handy to keep for safety-number display. */
  identityKey: string;
}

/**
 * Fetch a peer's bundle, consuming one of their one-time prekeys.
 * Falls back to a read-only fetch if the Cloud Function isn't deployed yet.
 */
export async function fetchPeerBundle(peerId: string): Promise<FetchedBundle> {
  try {
    const callable = functions().httpsCallable('fetchPreKeyBundle');
    const res = await callable({ peerId });
    const data = res.data as {
      identityKey: string;
      signingKey: string;
      signedPreKey: string;
      signedPreKeySignature: string;
      signedPreKeyId: number;
      oneTimePreKey?: { id: number; publicKey: string } | null;
    };
    return {
      identityKey: data.identityKey,
      bundle: {
        identityKey: fromB64(data.identityKey),
        signingKey: fromB64(data.signingKey),
        signedPreKey: fromB64(data.signedPreKey),
        signedPreKeySignature: fromB64(data.signedPreKeySignature),
        signedPreKeyId: data.signedPreKeyId,
        oneTimePreKey: data.oneTimePreKey
          ? { id: data.oneTimePreKey.id, publicKey: fromB64(data.oneTimePreKey.publicKey) }
          : undefined,
      },
    };
  } catch (e) {
    log.warn('fetchPreKeyBundle function unavailable, falling back to direct read', e);
    return fetchPeerBundleDirect(peerId);
  }
}

async function fetchPeerBundleDirect(peerId: string): Promise<FetchedBundle> {
  const snap = await db.collection('users').doc(peerId).get();
  if (!snap.exists) throw new Error(`no such user: ${peerId}`);
  const d = snap.data() ?? {};
  const pk = await db.collection('users').doc(peerId).collection(ONE_TIME_PREKEYS).limit(1).get();
  const first = pk.docs[0]?.data() as { id: number; publicKey: string } | undefined;
  return {
    identityKey: d.identityKey,
    bundle: {
      identityKey: fromB64(d.identityKey),
      signingKey: fromB64(d.signingKey ?? d.identityKey),
      signedPreKey: fromB64(d.signedPreKey),
      signedPreKeySignature: fromB64(d.signedPreKeySignature),
      signedPreKeyId: d.preKeyId ?? 1,
      oneTimePreKey: first ? { id: first.id, publicKey: fromB64(first.publicKey) } : undefined,
    },
  };
}

// local base64 decode (avoid a circular import with the crypto index)
function fromB64(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
