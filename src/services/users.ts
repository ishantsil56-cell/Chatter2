/**
 * User profiles, usernames and lookup.
 *
 * users/{uid}                 profile + public E2EE keys + username
 * usernames/{username}        { uid } — enforces uniqueness and powers exact
 *                             lookups (Firestore has no unique index, so we
 *                             claim the handle in a transaction)
 *
 * People find each other by username; email is kept only as account info.
 */

import { db, FieldValue, tsToMillis, type FirebaseFirestoreTypes } from './firebase';
import { normalizeEmail } from '@/utils/email';
import { normalizeUsername, validateUsername } from '@/utils/username';
import type { Contact, PresenceState, UserProfile } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('users');

const USERS = 'users';
const USERNAMES = 'usernames';

export interface ProfileSeed {
  email: string;
  username: string;
  /** Optional — used to pre-fill a new profile. */
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
  const ref = db.collection(USERS).doc(uid);
  const snap = await ref.get();
  const now = Date.now();
  const email = normalizeEmail(seed.email);

  if (!snap.exists) {
    const profile: UserProfile = {
      uid,
      email,
      username: normalizeUsername(seed.username),
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
    // The username is managed separately via setUsername().
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

// --- Usernames ----------------------------------------------------------------

/** Is this handle free? (Local validation + the uniqueness claim.) */
export async function isUsernameAvailable(rawUsername: string): Promise<boolean> {
  const username = normalizeUsername(rawUsername);
  if (!validateUsername(username).valid) return false;
  const snap = await db.collection(USERNAMES).doc(username).get();
  return !snap.exists;
}

/**
 * Claim a username for this user, releasing any previous one. Runs in a
 * transaction so two people can't grab the same handle at once.
 */
export async function setUsername(uid: string, rawUsername: string): Promise<string> {
  const username = normalizeUsername(rawUsername);
  const check = validateUsername(username);
  if (!check.valid) throw new Error(check.reason ?? 'Invalid username.');

  const usernameRef = db.collection(USERNAMES).doc(username);
  const userRef = db.collection(USERS).doc(uid);

  await db.runTransaction(async (tx) => {
    const [claimSnap, userSnap] = await Promise.all([tx.get(usernameRef), tx.get(userRef)]);

    const owner = claimSnap.exists ? (claimSnap.data()?.uid as string | undefined) : undefined;
    if (owner && owner !== uid) {
      throw new Error('That username is already taken.');
    }

    const current = userSnap.data()?.username as string | undefined;
    if (current && current !== username) {
      tx.delete(db.collection(USERNAMES).doc(current));
    }

    tx.set(usernameRef, { uid, username, updatedAt: Date.now() });
    tx.set(userRef, { username, updatedAt: Date.now() }, { merge: true });
  });

  log.info(`username @${username} claimed by ${uid}`);
  return username;
}

/** Exact lookup by handle. */
export async function findUserByUsername(rawUsername: string): Promise<Contact | null> {
  const username = normalizeUsername(rawUsername);
  if (!username) return null;
  const claim = await db.collection(USERNAMES).doc(username).get();
  const uid = claim.exists ? (claim.data()?.uid as string | undefined) : undefined;
  if (!uid) return null;
  const profile = await getUser(uid);
  return profile ? toContact(profile) : null;
}

/** Prefix search — the "find people" box. Returns up to `limit` matches. */
export async function searchUsersByUsername(rawPrefix: string, limit = 20): Promise<Contact[]> {
  const prefix = normalizeUsername(rawPrefix);
  if (prefix.length < 1) return [];

  const snap = await db
    .collection(USERS)
    .orderBy('username')
    .startAt(prefix)
    .endAt(`${prefix}\uf8ff`)
    .limit(limit)
    .get();

  return snap.docs.map((d) => toContact(normalizeProfile(d.data())));
}

// --- Profiles -----------------------------------------------------------------

export async function getUser(uid: string): Promise<UserProfile | null> {
  const snap = await db.collection(USERS).doc(uid).get();
  return snap.exists ? normalizeProfile(snap.data()) : null;
}

export function subscribeUser(
  uid: string,
  cb: (profile: UserProfile | null) => void,
): () => void {
  return db
    .collection(USERS)
    .doc(uid)
    .onSnapshot((snap) => cb(snap.exists ? normalizeProfile(snap.data()) : null));
}

export async function updateProfile(
  uid: string,
  patch: Partial<Pick<UserProfile, 'displayName' | 'about' | 'photoURL'>>,
): Promise<void> {
  await db.collection(USERS).doc(uid).set({ ...patch, updatedAt: Date.now() }, { merge: true });
}

/** Register this device's FCM token on the user document. */
export async function registerDeviceToken(
  uid: string,
  deviceId: string,
  fcmToken: string,
  platform: 'android' | 'ios',
): Promise<void> {
  await db
    .collection(USERS)
    .doc(uid)
    .collection('devices')
    .doc(deviceId)
    .set({ deviceId, fcmToken, platform, updatedAt: Date.now() });
}

export async function setPresence(uid: string, presence: PresenceState): Promise<void> {
  await db.collection(USERS).doc(uid).set({ presence }, { merge: true });
}

// --- Helpers ------------------------------------------------------------------

function toContact(p: UserProfile): Contact {
  return {
    uid: p.uid,
    displayName: p.displayName,
    username: p.username,
    email: p.email,
    photoURL: p.photoURL,
  };
}

function normalizeProfile(data: FirebaseFirestoreTypes.DocumentData | undefined): UserProfile {
  const d = data ?? {};
  return {
    uid: d.uid,
    email: d.email ?? '',
    username: d.username ?? '',
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
