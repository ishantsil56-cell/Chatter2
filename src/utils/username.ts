/**
 * Username rules.
 *
 * A username is a unique, lower-case handle people use to find each other
 * (like @ishant). We keep the rules strict so lookups and uniqueness checks
 * are predictable: 3–20 characters, letters, digits and underscores only.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

/** Reserved handles we never hand out. */
const RESERVED = new Set(['system', 'admin', 'chatter', 'support', 'help', 'me', 'you', 'null', 'undefined']);

/** Lower-case and strip everything we don't allow (used while typing). */
export function normalizeUsername(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}

export interface UsernameCheck {
  valid: boolean;
  reason?: string;
}

/** Local validation — the server still enforces uniqueness. */
export function validateUsername(value: string): UsernameCheck {
  const u = normalizeUsername(value);
  if (u.length < USERNAME_MIN) return { valid: false, reason: `At least ${USERNAME_MIN} characters.` };
  if (u.length > USERNAME_MAX) return { valid: false, reason: `At most ${USERNAME_MAX} characters.` };
  if (/^[0-9]/.test(u)) return { valid: false, reason: 'Cannot start with a number.' };
  if (RESERVED.has(u)) return { valid: false, reason: 'That username is reserved.' };
  return { valid: true };
}

/** Display form, e.g. @ishant */
export function displayUsername(username: string): string {
  return username ? `@${username}` : '';
}
