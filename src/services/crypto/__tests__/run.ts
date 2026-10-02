/**
 * Node test harness for the E2EE layer.
 *
 * Run it with:  npm run test:crypto
 * (or: npx tsx src/services/crypto/__tests__/run.ts)
 *
 * It exercises two independent SessionManagers talking to each other through
 * an in-memory store, covering the handshake, the ratchet in both directions,
 * out-of-order delivery, tamper detection and safety-number agreement.
 *
 * NOTE: this file is excluded from the app bundle — it imports no React Native.
 */

import { SessionManager } from '../session';
import { InMemoryKeyStore } from '../store';
import { b64 } from '../primitives';
import type { RemotePreKeyBundle } from '../x3dh';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.error(`  FAIL ${name}`);
  }
}

function bundleFor(manager: SessionManager): RemotePreKeyBundle {
  const { bundle, oneTimePreKeys } = manager.getPublicPreKeys();
  const first = oneTimePreKeys[0];
  if (!first) throw new Error('no one-time prekeys generated');
  return {
    identityKey: bundle.identityKey,
    signingKey: bundle.signingKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    signedPreKeyId: bundle.signedPreKeyId,
    oneTimePreKey: { id: first.id, publicKey: b64ToBytes(first.publicKey) },
  };
}

// The bundle builder needs the raw bytes; SessionManager exposes base64 in the
// public bundle, so decode here without importing the util (keeps the harness
// standalone).
function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function main(): Promise<void> {
  console.log('E2EE test harness\n');

  const storeA = new InMemoryKeyStore();
  const storeB = new InMemoryKeyStore();
  const alice = new SessionManager(storeA);
  const bob = new SessionManager(storeB);
  await alice.init();
  await bob.init();

  const ALICE = 'alice';
  const BOB = 'bob';

  // --- 1. Handshake + first message ----------------------------------------
  console.log('1. X3DH handshake and first message');
  await alice.createOutboundSession(BOB, bundleFor(bob));
  const p1 = await alice.encrypt(BOB, 'hello bob');
  check('ciphertext is not the plaintext', p1.ciphertext !== 'hello bob');
  check('first message carries X3DH ephemeral key', !!p1.header.ephemeralKey);
  check('first message carries a used prekey id', p1.header.usedPreKeyId != null);

  const r1 = await bob.decrypt(ALICE, b64(alice.getIdentity().identityKeyPair.publicKey), p1);
  check('bob decrypts alice first message', r1 === 'hello bob');

  // --- 2. Reply direction ---------------------------------------------------
  console.log('\n2. Reply direction (DH ratchet step)');
  const p2 = await bob.encrypt(ALICE, 'hi alice');
  check('second message drops the X3DH material', p2.header.ephemeralKey == null);
  const r2 = await alice.decrypt(BOB, b64(bob.getIdentity().identityKeyPair.publicKey), p2);
  check('alice decrypts bob reply', r2 === 'hi alice');

  // --- 3. Multiple messages both ways, ratchet advances ---------------------
  console.log('\n3. Multiple messages and ratchet advancement');
  const seen = new Set<string>();
  for (let i = 0; i < 5; i++) {
    const p = await alice.encrypt(BOB, `alice-${i}`);
    seen.add(p.ciphertext);
    const r = await bob.decrypt(ALICE, b64(alice.getIdentity().identityKeyPair.publicKey), p);
    check(`alice->bob #${i} round-trips`, r === `alice-${i}`);
  }
  check('every ciphertext is unique (fresh message keys)', seen.size === 5);

  for (let i = 0; i < 5; i++) {
    const p = await bob.encrypt(ALICE, `bob-${i}`);
    const r = await alice.decrypt(BOB, b64(bob.getIdentity().identityKeyPair.publicKey), p);
    check(`bob->alice #${i} round-trips`, r === `bob-${i}`);
  }

  // --- 4. Out-of-order delivery --------------------------------------------
  console.log('\n4. Out-of-order delivery (skipped message keys)');
  const outOfOrder: { text: string; payload: Awaited<ReturnType<typeof alice.encrypt>> }[] = [];
  for (let i = 0; i < 3; i++) {
    outOfOrder.push({ text: `ooo-${i}`, payload: await alice.encrypt(BOB, `ooo-${i}`) });
  }
  // Deliver 3rd, then 1st, then 2nd.
  const order = [2, 0, 1];
  for (const idx of order) {
    const entry = outOfOrder[idx]!;
    const r = await bob.decrypt(ALICE, b64(alice.getIdentity().identityKeyPair.publicKey), entry.payload);
    check(`out-of-order ${entry.text} decrypts`, r === entry.text);
  }

  // --- 5. Tamper detection --------------------------------------------------
  console.log('\n5. Tamper detection');
  const good = await alice.encrypt(BOB, 'integrity matters');
  const tampered = { ...good, ciphertext: flipLastByte(good.ciphertext) };
  let threw = false;
  try {
    await bob.decrypt(ALICE, b64(alice.getIdentity().identityKeyPair.publicKey), tampered);
  } catch {
    threw = true;
  }
  check('tampered ciphertext is rejected', threw);

  // --- 6. Safety number agreement ------------------------------------------
  console.log('\n6. Safety number');
  const snAlice = alice.safetyNumberWithPeer(BOB);
  const snBob = bob.safetyNumberWithPeer(ALICE);
  check('both sides compute the same safety number', snAlice === snBob);
  check('safety number is formatted', /\S/.test(snAlice));

  // --- 7. Persistence round-trip -------------------------------------------
  console.log('\n7. Session persistence (reload from store)');
  const alice2 = new SessionManager(storeA);
  const bob2 = new SessionManager(storeB);
  await alice2.init();
  await bob2.init();
  const p = await alice2.encrypt(BOB, 'after reload');
  const r = await bob2.decrypt(ALICE, b64(alice2.getIdentity().identityKeyPair.publicKey), p);
  check('sessions survive a manager restart', r === 'after reload');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

function flipLastByte(b64Str: string): string {
  const bytes = b64ToBytes(b64Str);
  bytes[bytes.length - 1] = (bytes[bytes.length - 1]! ^ 0x01) & 0xff;
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
