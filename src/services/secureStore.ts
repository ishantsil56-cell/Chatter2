/**
 * On-device secure storage for the E2EE layer.
 *
 * Threat model: a lost/stolen device or a filesystem dump should not hand an
 * attacker the ability to read message history. So:
 *
 *   - The identity (private keys) lives in the OS keychain/keystore
 *     (Android Keystore / iOS Keychain) via react-native-keychain, with the
 *     "require device unlock" style defaults.
 *   - Sessions are encrypted at rest with a random master key that itself lives
 *     in the keychain, and the ciphertext is kept in AsyncStorage. Without the
 *     master key the AsyncStorage blob is useless.
 *
 * This is deliberately separate from the crypto logic (see ./crypto/store.ts for
 * the interface and the in-memory implementation used by tests).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import { b64, fromB64, randomBytes, seal, open } from './crypto/primitives';
import { utf8ToBytes, bytesToUtf8 } from '@/utils/bytes';
import type { LocalIdentity, OneTimePreKey } from './crypto/identity';
import type { KeyStore, StoredSession } from './crypto/store';
import { scope } from '@/utils/logger';

const log = scope('secureStore');

const SERVICE_IDENTITY = 'com.sil.chatter.identity';
const SERVICE_MASTER = 'com.sil.chatter.master';
const SESSIONS_KEY = 'chatter.sessions.v1';

// --- Identity (keychain) ------------------------------------------------------

function serializeIdentity(i: LocalIdentity): string {
  return JSON.stringify({
    ik: b64(i.identityKeyPair.publicKey),
    iks: b64(i.identityKeyPair.secretKey),
    sk: b64(i.signingKeyPair.publicKey),
    sks: b64(i.signingKeyPair.secretKey),
    spk: b64(i.signedPreKey.publicKey),
    spks: b64(i.signedPreKey.secretKey),
    spkId: i.signedPreKeyId,
    spkSig: b64(i.signedPreKeySignature),
    otpks: i.oneTimePreKeys.map((k) => ({
      id: k.id,
      pub: b64(k.keyPair.publicKey),
      sec: b64(k.keyPair.secretKey),
    })),
    nextPreKeyId: i.nextPreKeyId,
    createdAt: i.createdAt,
  });
}

function deserializeIdentity(json: string): LocalIdentity {
  const r = JSON.parse(json) as {
    ik: string; iks: string; sk: string; sks: string;
    spk: string; spks: string; spkId: number; spkSig: string;
    otpks: { id: number; pub: string; sec: string }[];
    nextPreKeyId: number; createdAt: number;
  };
  const oneTimePreKeys: OneTimePreKey[] = r.otpks.map((k) => ({
    id: k.id,
    keyPair: { publicKey: fromB64(k.pub), secretKey: fromB64(k.sec) },
  }));
  return {
    identityKeyPair: { publicKey: fromB64(r.ik), secretKey: fromB64(r.iks) },
    signingKeyPair: { publicKey: fromB64(r.sk), secretKey: fromB64(r.sks) },
    signedPreKey: { publicKey: fromB64(r.spk), secretKey: fromB64(r.spks) },
    signedPreKeyId: r.spkId,
    signedPreKeySignature: fromB64(r.spkSig),
    oneTimePreKeys,
    nextPreKeyId: r.nextPreKeyId,
    createdAt: r.createdAt,
  };
}

// --- Sessions (encrypted AsyncStorage) ----------------------------------------

async function loadMasterKey(): Promise<Uint8Array> {
  const existing = await Keychain.getGenericPassword({ service: SERVICE_MASTER });
  if (existing) return fromB64(existing.password);
  const key = randomBytes(32);
  await Keychain.setGenericPassword('master', b64(key), {
    service: SERVICE_MASTER,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

let masterKeyPromise: Promise<Uint8Array> | null = null;

/** The device master key (created on first use, kept in the keychain). */
function masterKey(): Promise<Uint8Array> {
  if (!masterKeyPromise) {
    masterKeyPromise = loadMasterKey().catch((e) => {
      masterKeyPromise = null;
      throw e;
    });
  }
  return masterKeyPromise;
}

/**
 * Encrypt a string for local storage with the device master key. Used for
 * everything that holds message plaintext on disk (message cache, outbox).
 * Output is a compact JSON string safe to put in AsyncStorage.
 */
export async function sealLocal(text: string): Promise<string> {
  const sealed = seal(utf8ToBytes(text), await masterKey());
  return JSON.stringify({ n: b64(sealed.nonce), c: b64(sealed.ciphertext) });
}

/** Inverse of sealLocal. Returns null if the blob is unreadable (wrong key / corrupt). */
export async function openLocal(blob: string): Promise<string | null> {
  try {
    const { n, c } = JSON.parse(blob) as { n: string; c: string };
    const plaintext = open({ nonce: fromB64(n), ciphertext: fromB64(c) }, await masterKey());
    return plaintext ? bytesToUtf8(plaintext) : null;
  } catch {
    return null;
  }
}

export class SecureKeyStore implements KeyStore {
  private async master(): Promise<Uint8Array> {
    return masterKey();
  }

  async loadIdentity(): Promise<LocalIdentity | null> {
    const stored = await Keychain.getGenericPassword({ service: SERVICE_IDENTITY });
    if (!stored) return null;
    try {
      return deserializeIdentity(stored.password);
    } catch (e) {
      log.error('failed to parse stored identity', e);
      return null;
    }
  }

  async saveIdentity(identity: LocalIdentity): Promise<void> {
    await Keychain.setGenericPassword('identity', serializeIdentity(identity), {
      service: SERVICE_IDENTITY,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  private async readSessions(): Promise<Record<string, StoredSession>> {
    const blob = await AsyncStorage.getItem(SESSIONS_KEY);
    if (!blob) return {};
    const { nonce, ciphertext } = JSON.parse(blob) as { nonce: string; ciphertext: string };
    const plaintext = open({ nonce: fromB64(nonce), ciphertext: fromB64(ciphertext) }, await this.master());
    if (!plaintext) {
      log.error('session blob failed to decrypt — starting fresh');
      return {};
    }
    return JSON.parse(bytesToUtf8(plaintext)) as Record<string, StoredSession>;
  }

  private async writeSessions(sessions: Record<string, StoredSession>): Promise<void> {
    const sealed = seal(utf8ToBytes(JSON.stringify(sessions)), await this.master());
    await AsyncStorage.setItem(
      SESSIONS_KEY,
      JSON.stringify({ nonce: b64(sealed.nonce), ciphertext: b64(sealed.ciphertext) }),
    );
  }

  async loadSession(peerId: string): Promise<StoredSession | null> {
    return (await this.readSessions())[peerId] ?? null;
  }

  async loadAllSessions(): Promise<Record<string, StoredSession>> {
    return this.readSessions();
  }

  async saveSession(session: StoredSession): Promise<void> {
    const all = await this.readSessions();
    all[session.peerId] = session;
    await this.writeSessions(all);
  }

  async deleteSession(peerId: string): Promise<void> {
    const all = await this.readSessions();
    delete all[peerId];
    await this.writeSessions(all);
  }

  async consumeOneTimePreKey(id: number): Promise<void> {
    const identity = await this.loadIdentity();
    if (!identity) return;
    identity.oneTimePreKeys = identity.oneTimePreKeys.filter((k) => k.id !== id);
    await this.saveIdentity(identity);
  }

  /** Wipe everything (used by "Delete account"). */
  async wipe(): Promise<void> {
    await AsyncStorage.removeItem(SESSIONS_KEY);
    await Keychain.resetGenericPassword({ service: SERVICE_IDENTITY });
    await Keychain.resetGenericPassword({ service: SERVICE_MASTER });
    masterKeyPromise = null;
  }
}
