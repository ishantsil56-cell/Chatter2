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
 * Firebase errors carry a `code` like `auth/invalid-credential`. This maps the
 * common email/password ones to copy we can show a user directly.
 */
export function friendlyAuthMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code ?? '';
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email already has an account. Try signing in instead.';
    case 'auth/invalid-email':
      return 'That email address looks invalid.';
    case 'auth/weak-password':
      return 'Please choose a stronger password (at least 6 characters).';
    case 'auth/missing-password':
      return 'Please enter your password.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Email or password is incorrect.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and retry.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled yet. Turn it on in Firebase Authentication.';
    default:
      return messageOf(e);
  }
}
