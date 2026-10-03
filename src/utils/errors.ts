/** Normalise anything thrown into an Error with a readable message. */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  try {
    return new Error(JSON.stringify(e));
  } catch {
    return new Error('Unknown error');
  }
}

export function messageOf(e: unknown): string {
  return toError(e).message;
}

/**
 * Firebase errors carry a `code` like `auth/operation-not-allowed`. This maps
 * the common ones to copy we can show a user directly.
 */
export function friendlyAuthMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code ?? '';
  switch (code) {
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet. Enable the Google provider in Firebase Authentication.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and retry.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/invalid-credential':
      return 'That credential is no longer valid. Please try signing in again.';
    default:
      return messageOf(e);
  }
}

/**
 * Errors thrown by the Google Sign-In SDK itself (they use plain codes like
 * `SIGN_IN_CANCELLED`, not `auth/...`).
 */
export function friendlyGoogleMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code ?? '';
  switch (code) {
    case 'SIGN_IN_CANCELLED':
      return 'Sign-in was cancelled.';
    case 'IN_PROGRESS':
      return 'Sign-in is already in progress.';
    case 'PLAY_SERVICES_NOT_AVAILABLE':
      return 'Google Play Services is missing or out of date on this device.';
    default:
      return messageOf(e);
  }
}
