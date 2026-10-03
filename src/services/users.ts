/**
 * User profiles and lookup.
 *
 * users/{uid} holds the public profile plus the public halves of the E2EE
 * identity keys. Private keys never leave the device (see crypto/secureStore).
 *
 * People are identified by the email address from their Google account.
 */

import { db, FieldValue, tsToMillis, type FirebaseFirestoreTypes } from './firebase';
import { normalizeEmail } from '@/utils/email';
import type { Contact, PresenceState, UserProfile } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('users');

export interface ProfileSeed {
  email: string;
  /** From the Google account — used to pre-fill a new profile. */
  displayName?: string;
  photoURL?: string | null;
  identityKey: string;
  signingKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  preKeyId: number;
}

/**
 * Create the profile on first login, or refresh the published prekeys on every
 * login. Idempotent — safe to call on each app start.
 */
export async function ensureProfile(uid: string, seed: ProfileSeed): Promise<void> {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const now = Date.now();
  const email = normalizeEmail(seed.email);

  if (!snap.exists) {
    const profile: UserProfile = {
      uid,
      email,
      displayName: seed.displayName ?? '',
      about: 'Hey there! I am using Chatter.',
      photoURL: seed.photoURL ?? null,
      identityKey: seed.identityKey,
      signingKey: seed.signingKey,
      signedPreKey: seed.signedPreKey,
      signedPreKeySignature: seed.signedPreKeySignature,
      preKeyId: seed.preKeyId,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(profile);
    log.info(`created profile for ${uid}`);
  } else {
    // Keep the email and published keys current (signed prekey rotates).
    await ref.set(
      {
        email,
        identityKey: seed.identityKey,
        signingKey: seed.signingKey,
        signedPreKey: seed.signedPreKey,
        signedPreKeySignature: seed.signedPreKeySignature,
        preKeyId: seed.preKeyId,
        updatedAt: now,
      },
      { merge: true },
    );
  }
}

export async function getUser(uid: string): Promise<UserProfile | null> {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? normalizeProfile(snap.data()) : null;
}

export function subscribeUser(
  uid: string,
  cb: (profile: UserProfile | null) => void,
): () => void {
  return db
    .collection('users')
    .doc(uid)
    .onSnapshot((snap) => cb(snap.exists ? normalizeProfile(snap.data()) : null));
}

export async function updateProfile(
  uid: string,
  patch: Partial<Pick<UserProfile, 'displayName' | 'about' | 'photoURL'>>,
): Promise<void> {
  await db.collection('users').doc(uid).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

/** Exact-match lookup by email (used by the "new chat" screen). */
export async function findUserByEmail(email: string): Promise<Contact | null> {
  const snap = await db
    .collection('users')
    .where('email', '==', normalizeEmail(email))
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0]!;
  const p = normalizeProfile(doc.data());
  return { uid: p.uid, displayName: p.displayName, email: p.email, photoURL: p.photoURL };
}

export async function findUsersByEmails(emails: string[]): Promise<Contact[]> {
  if (emails.length === 0) return [];
  const normalized = emails.map(normalizeEmail);
  // Firestore 'in' queries cap at 10; chunk.
  const chunks: string[][] = [];
  for (let i = 0; i < normalized.length; i += 10) chunks.push(normalized.slice(i, i + 10));
  const results: Contact[] = [];
  for (const chunk of chunks) {
    const snap = await db.collection('users').where('email', 'in', chunk).get();
    for (const doc of snap.docs) {
      const p = normalizeProfile(doc.data());
      results.push({ uid: p.uid, displayName: p.displayName, email: p.email, photoURL: p.photoURL });
    }
  }
  return results;
}

/** Register this device's FCM token on the user document. */
export async function registerDeviceToken(
  uid: string,
  deviceId: string,
  fcmToken: string,
  platform: 'android' | 'ios',
): Promise<void> {
  await db
    .collection('users')
    .doc(uid)
    .collection('devices')
    .doc(deviceId)
    .set({ deviceId, fcmToken, platform, updatedAt: Date.now() });
}

export async function setPresence(uid: string, presence: PresenceState): Promise<void> {
  await db.collection('users').doc(uid).set({ presence }, { merge: true });
}

function normalizeProfile(data: FirebaseFirestoreTypes.DocumentData | undefined): UserProfile {
  const d = data ?? {};
  return {
    uid: d.uid,
    email: d.email ?? '',
    displayName: d.displayName ?? '',
    about: d.about ?? '',
    photoURL: d.photoURL ?? null,
    identityKey: d.identityKey ?? '',
    signingKey: d.signingKey ?? '',
    signedPreKey: d.signedPreKey ?? '',
    signedPreKeySignature: d.signedPreKeySignature ?? '',
    preKeyId: d.preKeyId ?? 0,
    createdAt: tsToMillis(d.createdAt),
    updatedAt: tsToMillis(d.updatedAt),
    presence: d.presence,
  };
}

// Re-export for callers that want the raw field value helper.
export { FieldValue };
