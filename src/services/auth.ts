/**
 * Phone-number authentication via Firebase Auth.
 *
 * Flow: requestOtp(phone) -> SMS code -> confirm(code). On success Firebase
 * gives us a user; the caller then makes sure a profile document exists
 * (see ./users.ts ensureProfile).
 *
 * Note: Android uses Firebase's app-verification (Play Integrity / reCAPTCHA)
 * automatically; for development you register a test phone number in the
 * Firebase console so you don't burn real SMS. See README.
 */

import { auth, type FirebaseAuthTypes } from './firebase';

export interface PendingOtp {
  /** The phone number the code was sent to (E.164). */
  phoneNumber: string;
  /** Submit the 6-digit code. Throws `auth/invalid-verification-code` etc. */
  confirm(code: string): Promise<FirebaseAuthTypes.UserCredential>;
}

export async function requestOtp(phoneE164: string): Promise<PendingOtp> {
  const confirmation = await auth().signInWithPhoneNumber(phoneE164);
  return {
    phoneNumber: phoneE164,
    confirm: (code: string) => confirmation.confirm(code),
  };
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

export async function signOut(): Promise<void> {
  await auth().signOut();
}

/** Force-refresh the ID token (used after account changes). */
export async function refreshIdToken(): Promise<void> {
  await auth().currentUser?.getIdToken(true);
}
