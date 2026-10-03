/**
 * Authentication via Google Sign-In + Firebase Auth.
 *
 * Flow: the user taps "Continue with Google" -> the native Google account
 * picker opens -> we get an ID token -> we exchange it for a Firebase session.
 * No SMS, no password, no per-message cost.
 *
 * Setup required (see README):
 *   - Enable the Google provider in Firebase Authentication.
 *   - Put your web client ID in src/config.ts (GOOGLE_WEB_CLIENT_ID).
 *   - Register your app's SHA-1 in Firebase (Android needs it).
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { auth, type FirebaseAuthTypes } from './firebase';
import { GOOGLE_WEB_CLIENT_ID } from '@/config';
import { scope } from '@/utils/logger';

const log = scope('auth');

let configured = false;

export function configureGoogleSignIn(): void {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: false,
  });
  configured = true;
}

export interface GoogleSignInResult {
  user: FirebaseAuthTypes.UserCredential['user'];
  /** True when the account was created by this sign-in. */
  isNewUser: boolean;
}

/**
 * Open the Google account picker and sign in to Firebase.
 * Throws on cancellation or failure — callers show the message to the user.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  configureGoogleSignIn();

  // Ensure Google Play Services is available and up to date.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();

  // The library has changed its return shape across versions; handle both.
  const raw = response as unknown as {
    idToken?: string | null;
    data?: { idToken?: string | null } | null;
  };
  const idToken = raw?.data?.idToken ?? raw?.idToken;

  if (!idToken) {
    throw new Error('Google Sign-In did not return an ID token. Check your web client ID.');
  }

  const credential = auth.GoogleAuthProvider.credential(idToken);
  const userCredential = await auth().signInWithCredential(credential);

  const isNewUser = userCredential.additionalUserInfo?.isNewUser ?? false;
  log.info(`signed in as ${userCredential.user.email ?? userCredential.user.uid}`);
  return { user: userCredential.user, isNewUser };
}

/** Sign out of both Google and Firebase. */
export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Not signed in to Google — ignore.
  }
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
