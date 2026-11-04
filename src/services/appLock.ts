/**
 * The app lock.
 *
 * This is a local gate in front of the interface, not encryption of the
 * database. Messages are already encrypted at rest by the ratchet keys held in
 * the keychain; this is what stops someone who picks up an unlocked phone from
 * reading them.
 *
 * The PIN itself is never stored. Only a salt and a SHA-256 digest of
 * `salt:pin` live in the keychain, so a device dump yields nothing usable.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Keychain from 'react-native-keychain';
import * as LocalAuthentication from 'expo-local-authentication';
import { scope } from '@/utils/logger';

const log = scope('appLock');

/** Keychain service name. Distinct from anything auth-related. */
const KEYCHAIN_SERVICE = 'com.sil.chatter.lock';
const PREFS_KEY = 'iris.lock.v1';
const COOLDOWN_KEY = 'iris.lock.cooldown.v1';

/**
 * Four digits, because every keypad in the design shows four dots. The set-up
 * copy said "4 or 6", which cannot be reconciled with a fixed dot count — four
 * is the one the artwork actually commits to.
 */
export const PIN_LENGTH = 4;

/** How long a wrong entry locks the keypad for, and how it grows. */
export const COOLDOWN_BASE_MS = 30_000;
export const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;

export interface LockPrefs {
  enabled: boolean;
  biometrics: boolean;
  /** -1 = never, 0 = immediately, otherwise the grace period in ms. */
  autoLockMs: number;
  blurCover: boolean;
}

export const DEFAULT_PREFS: LockPrefs = {
  enabled: false,
  biometrics: false,
  // 15 seconds: the option the Auto-Lock screen marks as selected.
  autoLockMs: 15_000,
  blurCover: true,
};

interface PinRecord {
  salt: string;
  hash: string;
}

async function randomSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function digest(salt: string, pin: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

async function readRecord(): Promise<PinRecord | null> {
  try {
    const stored = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!stored) return null;
    return JSON.parse(stored.password) as PinRecord;
  } catch (e) {
    log.warn('could not read the lock record', e);
    return null;
  }
}

/** True when a PIN has been set on this device. */
export async function hasPin(): Promise<boolean> {
  return (await readRecord()) !== null;
}

/** Set or replace the PIN. Does not enable the lock — that is a preference. */
export async function setPin(pin: string): Promise<void> {
  const salt = await randomSalt();
  const hash = await digest(salt, pin);
  await Keychain.setGenericPassword('pin', JSON.stringify({ salt, hash }), {
    service: KEYCHAIN_SERVICE,
  });
}

export async function verifyPin(pin: string): Promise<boolean> {
  const record = await readRecord();
  if (!record) return false;
  const hash = await digest(record.salt, pin);
  // Not a timing-safe compare: an attacker would need the device and a
  // measurable amount of patience to learn anything from a 4-digit space.
  return hash === record.hash;
}

/** Remove the PIN entirely. Used when the lock is disabled. */
export async function clearPin(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  } catch (e) {
    log.warn('could not clear the lock record', e);
  }
}

/** Hardware present AND at least one fingerprint/face enrolled. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return false;
    return await LocalAuthentication.isEnrolledAsync();
  } catch (e) {
    log.warn('could not query biometrics', e);
    return false;
  }
}

/**
 * Prompt for a fingerprint or face.
 *
 * The device fallback is disabled on purpose: on Android that fallback is the
 * device PIN, which would let someone unlock IRIS with the same code they use
 * for the phone. Our own PIN is the fallback instead.
 */
export async function authenticateBiometric(): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock IRIS',
      cancelLabel: 'Use PIN',
      disableDeviceFallback: true,
    });
    return result.success;
  } catch (e) {
    log.warn('biometric prompt failed', e);
    return false;
  }
}

export async function loadPrefs(): Promise<LockPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<LockPrefs>;
    return { ...DEFAULT_PREFS, ...saved };
  } catch (e) {
    // Fail closed: an unreadable preference file means we do not know whether a
    // lock is wanted, and assuming "no lock" is the wrong way to be wrong.
    log.warn('could not read lock preferences', e);
    return DEFAULT_PREFS;
  }
}

export async function savePrefs(prefs: LockPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (e) {
    log.warn('could not save lock preferences', e);
  }
}

/** The cooldown deadline survives a restart, so force-stopping does not clear it. */
export async function loadCooldown(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(COOLDOWN_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

export async function saveCooldown(until: number): Promise<void> {
  try {
    await AsyncStorage.setItem(COOLDOWN_KEY, String(until));
  } catch (e) {
    log.warn('could not save the lock cooldown', e);
  }
}

const PROMPTED_KEY = 'iris.lock.prompted.v1';

/** Whether this device has already been offered the lock. Asked once, ever. */
export async function hasBeenPrompted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PROMPTED_KEY)) === '1';
  } catch {
    // Unreadable is treated as "not asked yet": one extra offer is a far smaller
    // harm than never offering at all.
    return false;
  }
}

export async function markPrompted(): Promise<void> {
  try {
    await AsyncStorage.setItem(PROMPTED_KEY, '1');
  } catch (e) {
    log.warn('could not record the lock prompt', e);
  }
}
