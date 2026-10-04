/** An error whose message is already written for the user and may be shown as-is. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

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

/**
 * One place that turns ANY error into a short, friendly sentence for the UI.
 * Never include raw error text, ids or key material in what users see.
 */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof UserError) return e.message;
  const code = (e as { code?: string } | undefined)?.code ?? '';
  const message = messageOf(e);

  if (code.startsWith('auth/')) return friendlyAuthMessage(e);

  switch (code) {
    case 'firestore/unavailable':
    case 'unavailable':
    case 'firestore/deadline-exceeded':
    case 'deadline-exceeded':
      return 'You appear to be offline. We’ll keep trying.';
    case 'firestore/permission-denied':
    case 'permission-denied':
      return 'You don’t have permission to do that.';
    case 'firestore/not-found':
    case 'not-found':
      return 'That no longer exists.';
    case 'firestore/resource-exhausted':
    case 'resource-exhausted':
      return 'The free daily limit was reached. Try again tomorrow.';
    case 'firestore/unauthenticated':
    case 'unauthenticated':
      return 'Please sign in again.';
    default:
      break;
  }

  if (/network|offline|timed out|timeout|unavailable/i.test(message)) {
    return 'Network problem. Check your connection and try again.';
  }
  if (/not finished setting up encryption/i.test(message)) {
    return 'That person hasn’t finished setting up yet.';
  }
  if (/no such user|cannot resolve identity/i.test(message)) {
    return 'We couldn’t find that person.';
  }
  return fallback;
}
