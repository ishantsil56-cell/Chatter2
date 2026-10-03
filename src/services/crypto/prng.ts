/**
 * Secure random source for tweetnacl on React Native.
 *
 * IMPORTANT — this fixes a real crash.
 *
 * tweetnacl ships three ways to get random bytes: `window.crypto.getRandomValues`
 * (browsers), `window.msCrypto` (old IE), and Node's `crypto.randomBytes`.
 * React Native has none of them, so `nacl.randomBytes` — and therefore
 * `nacl.box.keyPair` / `nacl.sign.keyPair` — throws "no PRNG". Since the app
 * generates key pairs on first launch, every login crashed.
 *
 * We fix it by pointing tweetnacl at `expo-crypto`, a first-party Expo native
 * module that is always linked into an Expo build, so it works regardless of
 * how the APK was built.
 *
 * The app entry (`index.ts`) imports this module for its side effect, before
 * anything else. It is deliberately NOT imported by the crypto primitives, so
 * the Node test harness — where tweetnacl already has a working PRNG — can run
 * the crypto layer without any React Native modules.
 */

import * as nacl from 'tweetnacl';
import { getRandomBytes } from 'expo-crypto';

type NaclWithPrng = typeof nacl & {
  setPRNG: (fn: (x: Uint8Array, n: number) => void) => void;
};

(nacl as NaclWithPrng).setPRNG((x: Uint8Array, n: number) => {
  const bytes = getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});
