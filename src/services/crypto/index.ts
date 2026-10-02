/**
 * E2EE layer entry point.
 *
 * Public API for the rest of the app:
 *
 *   import { getCrypto } from '@/services/crypto';
 *   const crypto = getCrypto();
 *   await crypto.init();
 *   const payload = await crypto.encrypt(peerId, 'hello');
 *   const text = await crypto.decrypt(peerId, senderIdentityKey, payload);
 *
 * See docs/ARCHITECTURE.md for the threat model and the caveats (this is a
 * careful, working implementation of Signal's ideas, not an audited library).
 */

export * from './primitives';
export * from './x3dh';
export * from './identity';
export * from './ratchet';
export * from './store';
export * from './session';

import { SessionManager } from './session';
import { SecureKeyStore } from '../secureStore';

let instance: SessionManager | null = null;

/** Process-wide singleton backed by secure on-device storage. */
export function getCrypto(): SessionManager {
  if (!instance) {
    instance = new SessionManager(new SecureKeyStore());
  }
  return instance;
}

/** Test/DI hook. */
export function setCrypto(manager: SessionManager): void {
  instance = manager;
}
