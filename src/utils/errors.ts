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
 * Firebase errors carry a `code` like `auth/invalid-verification-code`.
 * This maps the common ones to copy we can show a user directly.
 */
export function friendlyAuthMessage(e: unknown): string {
  const code = (e as { code?: string } | undefined)?.code ?? '';
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'That phone number looks invalid. Check the country code and try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a bit and try again.';
    case 'auth/invalid-verification-code':
      return 'That code is incorrect. Double-check the six digits.';
    case 'auth/code-expired':
      return 'That code has expired. Request a new one.';
    case 'auth/quota-exceeded':
      return 'SMS quota exceeded for now. Try again later.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection and retry.';
    default:
      return messageOf(e);
  }
}
