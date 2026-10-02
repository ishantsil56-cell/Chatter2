/**
 * Holds the in-flight OTP confirmation between the phone and OTP screens.
 * Kept out of navigation params because the confirmation object isn't
 * serialisable.
 */

import type { PendingOtp } from './auth';

let pending: PendingOtp | null = null;

export function setPendingOtp(value: PendingOtp | null): void {
  pending = value;
}

export function getPendingOtp(): PendingOtp | null {
  return pending;
}

export function clearPendingOtp(): void {
  pending = null;
}
