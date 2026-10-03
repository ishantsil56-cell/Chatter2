/**
 * Email helpers. The app identifies people by their email address (from their
 * Google account), so lookups and comparisons must be normalised the same way.
 */

/** Trim and lower-case — emails are case-insensitive for our purposes. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Loose validity check — enough to catch obvious typos before a lookup. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Display form (identical to normalised, but kept for symmetry with phone.ts). */
export function formatEmailDisplay(email: string): string {
  return normalizeEmail(email);
}
