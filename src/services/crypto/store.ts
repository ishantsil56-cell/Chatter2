/**
 * Storage contract for the E2EE layer.
 *
 * The crypto code never touches a concrete storage API directly — it talks to
 * this interface. Two implementations exist:
 *   - InMemoryKeyStore  (this file)  — used by the Node test harness.
 *   - SecureKeyStore    (../secureStore.ts) — keychain + encrypted AsyncStorage
 *     on the device.
 */

import type { KeyPair } from './primitives';
import type { LocalIdentity } from './identity';
import type { RatchetState } from './ratchet';

export interface StoredSession {
  peerId: string;
  /** Peer's identity public key (base64) — needed to rebuild associated data. */
  peerIdentityKey: string;
  ratchet: RatchetState;
  isInitiator: boolean;
  /**
   * X3DH material that rides on every outbound message until the peer has
   * answered at least once (the same rule Signal uses for "pre-key messages").
   * Keeping it means the very first message can be lost, delayed or re-ordered
   * and the recipient can still bootstrap the session from any later one.
   */
  pendingEphemeralKey: string | null;
  pendingUsedPreKeyId: number | null;
  /** Inbound sessions only: the initiator's ephemeral key that created this session. */
  peerEphemeralKey?: string | null;
  /** Handshakes (ephemeral keys) already adopted — so an old first message can't reset a live session. */
  handshakes?: string[];
  createdAt: number;
}

export interface KeyStore {
  loadIdentity(): Promise<LocalIdentity | null>;
  saveIdentity(identity: LocalIdentity): Promise<void>;
  loadSession(peerId: string): Promise<StoredSession | null>;
  loadAllSessions(): Promise<Record<string, StoredSession>>;
  saveSession(session: StoredSession): Promise<void>;
  deleteSession(peerId: string): Promise<void>;
  /** Remove a consumed one-time prekey so it can never be reused. */
  consumeOneTimePreKey(id: number): Promise<void>;
}

/** In-memory store — deterministic and dependency-free, for tests. */
export class InMemoryKeyStore implements KeyStore {
  private identity: LocalIdentity | null = null;
  private sessions = new Map<string, StoredSession>();

  async loadIdentity(): Promise<LocalIdentity | null> {
    return this.identity;
  }

  async saveIdentity(identity: LocalIdentity): Promise<void> {
    this.identity = identity;
  }

  async loadSession(peerId: string): Promise<StoredSession | null> {
    return this.sessions.get(peerId) ?? null;
  }

  async loadAllSessions(): Promise<Record<string, StoredSession>> {
    return Object.fromEntries(this.sessions.entries());
  }

  async saveSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.peerId, session);
  }

  async deleteSession(peerId: string): Promise<void> {
    this.sessions.delete(peerId);
  }

  async consumeOneTimePreKey(id: number): Promise<void> {
    if (!this.identity) return;
    this.identity = {
      ...this.identity,
      oneTimePreKeys: this.identity.oneTimePreKeys.filter((k) => k.id !== id),
    };
  }

  /** Test helper: pull a private one-time prekey back out. */
  getOneTimePreKey(id: number): KeyPair | null {
    return this.identity?.oneTimePreKeys.find((k) => k.id === id)?.keyPair ?? null;
  }
}
