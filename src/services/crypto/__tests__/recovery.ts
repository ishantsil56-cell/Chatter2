/**
 * Session reliability tests: first-message recovery, missing prekeys, reinstalls,
 * simultaneous first messages (glare), replay protection and Unicode.
 * Run:  npm run test:crypto   (or: npx tsx src/services/crypto/__tests__/recovery.ts)
 */
import { SessionManager, cryptoErrorCode, type EncryptedPayload } from '../session';
import { InMemoryKeyStore } from '../store';
import { b64, fromB64 } from '../primitives';
import type { RemotePreKeyBundle } from '../x3dh';
import { check, section, rejects, finish } from '../../__tests__/check';

async function make(): Promise<SessionManager> {
  const m = new SessionManager(new InMemoryKeyStore());
  await m.init();
  return m;
}

function bundleFor(m: SessionManager, withOneTime = true, which = 0): RemotePreKeyBundle {
  const { bundle, oneTimePreKeys } = m.getPublicPreKeys();
  const otp = oneTimePreKeys[which];
  return {
    identityKey: bundle.identityKey,
    signingKey: bundle.signingKey,
    signedPreKey: bundle.signedPreKey,
    signedPreKeySignature: bundle.signedPreKeySignature,
    signedPreKeyId: bundle.signedPreKeyId,
    oneTimePreKey: withOneTime && otp ? { id: otp.id, publicKey: fromB64(otp.publicKey) } : undefined,
  };
}

const ik = (m: SessionManager): string => b64(m.getIdentity().identityKeyPair.publicKey);

async function main(): Promise<void> {
  // --- 1. Missing one-time prekey -------------------------------------------
  section('1. One-time prekey missing or already used');
  {
    const alice = await make();
    const bob = await make();
    // Alice builds a bundle around a one-time prekey id Bob does not have.
    const bad = bundleFor(bob);
    bad.oneTimePreKey = { id: 9999, publicKey: bad.oneTimePreKey!.publicKey };
    await alice.createOutboundSession('bob', bad);
    const p = await alice.encrypt('bob', 'hello');
    const err = await rejects(() => bob.decrypt('alice', ik(alice), p));
    check('decrypt fails with prekey-missing', cryptoErrorCode(err) === 'prekey-missing', err);
    check('failure leaves no poisoned session behind', !bob.hasSession('alice'));

    // Fallback: signed-prekey-only handshake works.
    const alice2 = await make();
    await alice2.createOutboundSession('bob', bundleFor(bob, false));
    const p2 = await alice2.encrypt('bob', 'no one-time prekey needed');
    check('signed-prekey-only message has no usedPreKeyId', p2.header.usedPreKeyId == null);
    check('signed-prekey-only message decrypts', (await bob.decrypt('alice', ik(alice2), p2)) === 'no one-time prekey needed');

    // Recovery: sender resets and retries with a fallback handshake.
    await alice.createOutboundSession('bob', bundleFor(bob, false), { replace: true });
    const p3 = await alice.encrypt('bob', 'retry after reset');
    check('retry after reset decrypts', (await bob.decrypt('alice', ik(alice), p3)) === 'retry after reset');
  }

  // --- 2. Bad first message cannot poison a session --------------------------
  section('2. A corrupt first message does not poison the session');
  {
    const alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    const good = await alice.encrypt('bob', 'real first message');
    const raw = fromB64(good.ciphertext).slice();
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    const flipped = b64(raw);
    const err = await rejects(() => bob.decrypt('alice', ik(alice), { ...good, ciphertext: flipped }));
    check('tampered first message rejected', cryptoErrorCode(err) === 'bad-message', err);
    check('no session was created by the bad message', !bob.hasSession('alice'));
    check('one-time prekey NOT consumed by a failed decrypt', bob.getIdentity().oneTimePreKeys.length === 50);
    check('genuine first message still decrypts', (await bob.decrypt('alice', ik(alice), good)) === 'real first message');
    check('one-time prekey consumed after success', bob.getIdentity().oneTimePreKeys.length === 49);
  }

  // --- 3. Lost / re-ordered first message ------------------------------------
  section('3. First message lost or delayed');
  {
    const alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    const m1 = await alice.encrypt('bob', 'one');
    const m2 = await alice.encrypt('bob', 'two');
    const m3 = await alice.encrypt('bob', 'three');
    check('X3DH header persists until a reply', !!m2.header.ephemeralKey && !!m3.header.ephemeralKey);
    check('alice knows she is waiting for a reply', alice.isAwaitingFirstReply('bob'));
    check('bob bootstraps from the SECOND message', (await bob.decrypt('alice', ik(alice), m2)) === 'two');
    check('the delayed first message still decrypts', (await bob.decrypt('alice', ik(alice), m1)) === 'one');
    check('third message decrypts', (await bob.decrypt('alice', ik(alice), m3)) === 'three');
    check('a duplicate delivery is rejected, not re-applied', cryptoErrorCode(await rejects(() => bob.decrypt('alice', ik(alice), m3))) === 'bad-message');
    const reply = await bob.encrypt('alice', 'got them');
    check('reply carries no handshake', reply.header.ephemeralKey == null);
    check('alice decrypts the reply', (await alice.decrypt('bob', ik(bob), reply)) === 'got them');
    check('header dropped once the peer has answered', !alice.isAwaitingFirstReply('bob') && (await alice.encrypt('bob', 'x')).header.ephemeralKey == null);
  }

  // --- 4. Peer reinstalled (new identity) -------------------------------------
  section('4. Recipient reinstalled the app');
  {
    const alice = await make();
    let bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    await bob.decrypt('alice', ik(alice), await alice.encrypt('bob', 'before'));
    await alice.decrypt('bob', ik(bob), await bob.encrypt('alice', 'ack'));

    bob = await make(); // brand-new identity, no sessions
    const stale = await alice.encrypt('bob', 'sent to the old identity');
    check('new install cannot read old-session traffic', cryptoErrorCode(await rejects(() => bob.decrypt('alice', ik(alice), stale))) === 'no-session');
    check('alice detects the key change', alice.sessionPeerIdentityKey('bob') !== ik(bob));
    await alice.createOutboundSession('bob', bundleFor(bob), { replace: true });
    const fresh = await alice.encrypt('bob', 'after reinstall');
    check('new install decrypts after alice re-keys', (await bob.decrypt('alice', ik(alice), fresh)) === 'after reinstall');
  }

  // --- 5. Sender reinstalled ---------------------------------------------------
  section('5. Sender reinstalled the app');
  {
    let alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    await bob.decrypt('alice', ik(alice), await alice.encrypt('bob', 'first'));
    await alice.decrypt('bob', ik(bob), await bob.encrypt('alice', 'ack'));

    alice = await make(); // new identity
    await alice.createOutboundSession('bob', bundleFor(bob, true, 1));
    const p = await alice.encrypt('bob', 'hi again, new phone');
    check('bob adopts the new handshake', (await bob.decrypt('alice', ik(alice), p)) === 'hi again, new phone');
    check('bob can reply on the new session', (await alice.decrypt('bob', ik(bob), await bob.encrypt('alice', 'welcome back'))) === 'welcome back');
  }

  // --- 6. Glare: both sides start a session at once ---------------------------
  section('6. Simultaneous first messages (glare)');
  {
    const alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    await bob.createOutboundSession('alice', bundleFor(alice));
    const a1 = await alice.encrypt('bob', 'from alice');
    const b1 = await bob.encrypt('alice', 'from bob');

    const aliceWins = b64(alice.getIdentity().identityKeyPair.publicKey) < b64(bob.getIdentity().identityKeyPair.publicKey);
    const [winner, loser, w1, l1, wName, lName] = aliceWins
      ? [alice, bob, a1, b1, 'alice', 'bob']
      : [bob, alice, b1, a1, 'bob', 'alice'];

    const conflict = await rejects(() => winner.decrypt(lName, ik(loser), l1));
    check('the winning side refuses the loser\'s competing handshake', cryptoErrorCode(conflict) === 'session-conflict', conflict);
    check('the losing side adopts the winner\'s session', (await loser.decrypt(wName, ik(winner), w1)) === (aliceWins ? 'from alice' : 'from bob'));

    // The loser's earlier message is unreadable; they re-send it on the adopted session.
    const resent = await loser.encrypt(wName, aliceWins ? 'from bob' : 'from alice');
    check('loser\'s re-sent message reaches the winner', (await winner.decrypt(lName, ik(loser), resent)) === (aliceWins ? 'from bob' : 'from alice'));
    check('conversation continues both ways', (await loser.decrypt(wName, ik(winner), await winner.encrypt(lName, 'ok'))) === 'ok');
  }

  // --- 7. Replaying an old handshake cannot reset a live session ---------------
  section('7. Replay of an old first message');
  {
    const alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob, false)); // no OTPK => replayable
    const first = await alice.encrypt('bob', 'first');
    await bob.decrypt('alice', ik(alice), first);
    await alice.decrypt('bob', ik(bob), await bob.encrypt('alice', 'ack'));
    const live = await alice.encrypt('bob', 'live message');
    const replayErr = await rejects(() => bob.decrypt('alice', ik(alice), first));
    check('replayed first message is rejected', replayErr !== null);
    check('the live session still works afterwards', (await bob.decrypt('alice', ik(alice), live)) === 'live message');
  }

  // --- 8. Unicode ---------------------------------------------------------------
  section('8. Non-ASCII text round-trips');
  {
    const alice = await make();
    const bob = await make();
    await alice.createOutboundSession('bob', bundleFor(bob));
    const samples = ['नमस्ते दुनिया', 'வணக்கம்', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'হ্যালো', '👨‍👩‍👧‍👦 🇮🇳 ❤️', 'मिक्स mixed 😀 text'];
    for (const s of samples) {
      const p: EncryptedPayload = await alice.encrypt('bob', s);
      check(`round-trips: ${s}`, (await bob.decrypt('alice', ik(alice), p)) === s);
    }
  }

  // --- 9. Prekey listener ---------------------------------------------------------
  section('9. Prekey bookkeeping');
  {
    const alice = await make();
    const bob = await make();
    const consumed: number[] = [];
    let replenished = 0;
    bob.setPreKeyListener({ consumed: (id) => consumed.push(id), replenished: () => replenished++ });
    await alice.createOutboundSession('bob', bundleFor(bob));
    const p = await alice.encrypt('bob', 'hi');
    await bob.decrypt('alice', ik(alice), p);
    check('consumed listener fired once with the used id', consumed.length === 1 && consumed[0] === p.header.usedPreKeyId);
    check('pool is not replenished while still healthy', replenished === 0);
  }

  finish('session recovery');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
