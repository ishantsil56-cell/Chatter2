/**
 * Authentication via email + password (Firebase Auth).
 *
 * Deliberately plain: no SMS, no OAuth, and — importantly — no native module,
 * so there is nothing here that can hard-crash the app. Works on the free
 * Spark plan. After signing up, the user picks a username (see ProfileSetup).
 */

import { auth, type FirebaseAuthTypes } from './firebase';
import { normalizeEmail } from '@/utils/email';
import { scope } from '@/utils/logger';

const log = scope('auth');

export const MIN_PASSWORD_LENGTH = 6;

/** Create a new account. Throws `auth/email-already-in-use`, etc. */
export async function signUpWithEmail(
  email: string,
  password: string,
): Promise<FirebaseAuthTypes.UserCredential> {
  const cred = await auth().createUserWithEmailAndPassword(normalizeEmail(email), password);
  log.info(`account created for ${normalizeEmail(email)}`);
  return cred;
}

/** Sign in to an existing account. Throws `auth/invalid-credential`, etc. */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<FirebaseAuthTypes.UserCredential> {
  const cred = await auth().signInWithEmailAndPassword(normalizeEmail(email), password);
  log.info(`signed in as ${normalizeEmail(email)}`);
  return cred;
}

/**
 * Confirm the password is really this account's password (used before we wrap a
 * history key with it — a typo there would lock the user out of their backup).
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const user = auth().currentUser;
  if (!user?.email) return false;
  try {
    await user.reauthenticateWithCredential(auth.EmailAuthProvider.credential(user.email, password));
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      return false;
    }
    throw e; // network etc. — let the caller show a friendly message
  }
}

/** Send a password-reset email. */
export async function sendPasswordReset(email: string): Promise<void> {
  await auth().sendPasswordResetEmail(normalizeEmail(email));
}

export async function signOut(): Promise<void> {
  await auth().signOut();
}

export function currentUser(): FirebaseAuthTypes.User | null {
  return auth().currentUser;
}

export function currentUid(): string | null {
  return auth().currentUser?.uid ?? null;
}

export function onAuthStateChanged(
  cb: (user: FirebaseAuthTypes.User | null) => void,
): () => void {
  return auth().onAuthStateChanged(cb);
}

/** Force-refresh the ID token (used after account changes). */
export async function refreshIdToken(): Promise<void> {
  await auth().currentUser?.getIdToken(true);
}
