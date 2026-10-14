/**
 * One import surface for Firebase so the rest of the app never reaches into
 * the native modules directly. Also centralises the few Firestore helpers we
 * reuse everywhere.
 */

import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore, { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';

import messaging from '@react-native-firebase/messaging';

// `storage` is gone: Cloud Storage needs the Blaze plan, and all media now goes
// to Cloudflare R2 through the Worker instead. Dropping it removes a native
// module from the build as well as a dependency that could never work.
export { auth, firestore, messaging };
export type { FirebaseAuthTypes, FirebaseFirestoreTypes };

/** Firestore instance. */
export const db = firestore();

/** Sentinel for server timestamps / array ops. */
export const FieldValue = firestore.FieldValue;

/** Convert a Firestore timestamp (or number) to epoch millis. */
export function tsToMillis(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const maybe = value as { toMillis?: () => number };
  if (typeof maybe.toMillis === 'function') return maybe.toMillis();
  return 0;
}
