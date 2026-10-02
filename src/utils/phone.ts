/**
 * Phone number handling.
 *
 * Firebase phone auth wants E.164 (`+<country><number>`). Rather than pull in a
 * heavy lib, we keep a default calling code and normalise what the user types.
 * The default country code is configurable in Settings; India is the default.
 */

export const DEFAULT_COUNTRY_CODE = '+91';

export function digitsOnly(input: string): string {
  return input.replace(/[^\d]/g, '');
}

/**
 * Normalise a user-typed number to E.164.
 * - Strips spaces, dashes and parentheses.
 * - Keeps a leading `+` if present.
 * - Applies the default country code when the user omits one.
 */
export function toE164(input: string, countryCode: string = DEFAULT_COUNTRY_CODE): string {
  const trimmed = input.trim();
  const hadPlus = trimmed.startsWith('+');
  const digits = digitsOnly(trimmed);
  if (!digits) return '';

  if (hadPlus) return `+${digits}`;
  // A number already carrying a country code but typed without '+' is ambiguous;
  // treat a leading 0 as a national trunk prefix and drop it.
  const national = digits.startsWith('0') ? digits.slice(1) : digits;
  const cc = digitsOnly(countryCode);
  return `+${cc}${national}`;
}

/** Loose validity check — E.164 allows 8–15 digits after the '+'. */
export function isValidE164(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(value);
}

/** Pretty display form: +91 98765 43210 */
export function formatPhoneDisplay(e164: string): string {
  const m = /^\+(\d{1,3})(\d+)$/.exec(e164);
  if (!m) return e164;
  const cc = m[1] ?? '';
  const rest = m[2] ?? '';
  if (rest.length === 10) return `+${cc} ${rest.slice(0, 5)} ${rest.slice(5)}`;
  return `+${cc} ${rest}`;
}
