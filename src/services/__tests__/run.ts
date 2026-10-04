/**
 * Service-layer tests: users, chats, messages, receipts, outbox, resend, history
 * backup, pagination, presence — running the REAL service code against an
 * in-memory Firestore (see harness.ts / fakeFirestore.ts).
 *
 * Run:  npm run test:services
 */
import { fakeDb, resetWorld, useDevice, sleep, readStorage } from './harness';
import { check, section, rejects, finish } from './check';
import { SessionManager } from '../crypto/session';
import { InMemoryKeyStore } from '../crypto/store';
import { b64 } from '../crypto/primitives';
import { ensureProfile, setPresence, setUsername, findUserByUsername } from '../users';
import { publishPreKeys, deletePublishedPreKey } from '../prekeys';
import { ensureDirectChat, createGroup, setLastRead, requestResend, subscribeResendRequests, setTyping, resendRequestId } from '../chats';
import {
  sendMessage, decryptMessage, markDelivered, markRead, ackUndelivered, ingestRecent, subscribeMessages,
  previewFor, previewText, PAGE_SIZE,
} from '../messages';
import { putPlaintext, getPlaintextSync, flushPlaintextCache, resetPlaintextCacheForTests, warmPlaintextCache } from '../messageCache';
import { enqueue, flush, retry, discard, getOutbox, subscribeOutbox, resetOutboxForTests } from '../outbox';
import { serveResendRequests } from '../resend';
import { unlockHistoryKey } from '../historyKey';
import { deliveryStatus, mergeReceipt } from '../../utils/receipts';
import { friendlyError } from '../../utils/errors';
import { truncate } from '../../utils/text';
import { isOnline, activeTypers } from '../../utils/presence';
import type { DecryptedMessage, Message } from '../../types';

interface Phone {
  uid: string;
  device: string;
  mgr: SessionManager;
}

async function newPhone(uid: string, device = uid): Promise<Phone> {
  await useDevice(device, { fresh: true });
  const mgr = new SessionManager(new InMemoryKeyStore());
  await mgr.init();
  const { bundle } = mgr.getPublicPreKeys();
  await ensureProfile(uid, {
    email: `${uid}@example.com`,
    username: '',
    identityKey: b64(bundle.identityKey),
    signingKey: b64(bundle.signingKey),
    signedPreKey: b64(bundle.signedPreKey),
    signedPreKeySignature: b64(bundle.signedPreKeySignature),
    preKeyId: bundle.signedPreKeyId,
  });
  mgr.setPreKeyListener({ consumed: (id) => void deletePublishedPreKey(uid, id) });
  await publishPreKeys(uid, mgr.getIdentity());
  return { uid, device, mgr };
}

const poolSize = (uid: string): number => [...fakeDb.docs.keys()].filter((k) => k.startsWith(`users/${uid}/prekeys/`)).length;
const messageDocs = (chatId: string): [string, Record<string, any>][] =>
  [...fakeDb.docs.entries()].filter(([k]) => k.startsWith(`chats/${chatId}/messages/`)) as any;
const asMsg = (chatId: string, id: string): Message => ({ id, ...(fakeDb.docs.get(`chats/${chatId}/messages/${id}`) as object) }) as Message;

async function main(): Promise<void> {
  // ---------------------------------------------------------------- pure helpers
  section('Receipt semantics');
  check('1:1 — only "sent" => sent', deliveryStatus({ a: 'sent', b: 'sent' }, 'a', ['a', 'b']) === 'sent');
  check('1:1 — delivered => delivered', deliveryStatus({ a: 'sent', b: 'delivered' }, 'a', ['a', 'b']) === 'delivered');
  check('1:1 — read => read', deliveryStatus({ a: 'sent', b: 'read' }, 'a', ['a', 'b']) === 'read');
  const group = ['a', 'b', 'c', 'd'];
  check('group — one of three delivered stays sent', deliveryStatus({ a: 'sent', b: 'delivered', c: 'sent', d: 'sent' }, 'a', group) === 'sent');
  check('group — all delivered => delivered', deliveryStatus({ a: 'sent', b: 'delivered', c: 'read', d: 'delivered' }, 'a', group) === 'delivered');
  check('group — blue only when ALL read', deliveryStatus({ a: 'sent', b: 'read', c: 'read', d: 'delivered' }, 'a', group) === 'delivered');
  check('group — all read => read', deliveryStatus({ a: 'sent', b: 'read', c: 'read', d: 'read' }, 'a', group) === 'read');
  check('someone who LEFT does not block blue ticks', deliveryStatus({ a: 'sent', b: 'read', c: 'sent' }, 'a', ['a', 'b']) === 'read');
  check('someone who JOINED later without a receipt blocks nothing wrongly (counts as unread)', deliveryStatus({ a: 'sent', b: 'read' }, 'a', ['a', 'b', 'z']) === 'sent');
  check('receipts never regress', mergeReceipt('read', 'delivered') === 'read' && mergeReceipt('sent', 'delivered') === 'delivered');

  section('Text, presence and error helpers');
  check('truncate never splits an emoji', Array.from(truncate('😀'.repeat(100), 80)).length === 81 && !/[\ud800-\udbff](?![\udc00-\udfff])/.test(truncate('😀'.repeat(100), 80)));
  check('truncate keeps Devanagari intact', truncate('नमस्ते', 80) === 'नमस्ते');
  check('previews are placeholders for non-text', previewFor('image') === 'Photo' && previewFor('voice') === 'Voice message');
  check('local text preview collapses whitespace', previewText('text', 'a\n\n b   c') === 'a b c');
  const now = 1_000_000;
  check('presence: fresh heartbeat is online', isOnline({ online: true, lastSeen: now - 10_000 }, now));
  check('presence: stale heartbeat is NOT online', !isOnline({ online: true, lastSeen: now - 120_000 }, now));
  check('typing: stale entries expire', activeTypers([{ uid: 'b', at: now - 20_000 }, { uid: 'c', at: now - 1000 }], 'a', now).join() === 'c');
  check('friendlyError: offline code', /offline/i.test(friendlyError({ code: 'firestore/unavailable' })));
  check('friendlyError: never leaks raw text', friendlyError(new Error('weird INTERNAL at line 42 key=abc')) === 'Something went wrong. Please try again.');
  check('friendlyError: auth code', /incorrect/i.test(friendlyError({ code: 'auth/invalid-credential' })));

  // ---------------------------------------------------------------- users
  section('Users');
  resetWorld();
  await newPhone('alice');
  check('username claim creates the handle', (await setUsername('alice', 'Alice_W')) === 'alice_w');
  check('lookup by handle finds her', (await findUserByUsername('@alice_w'))?.uid === 'alice');
  const bobProbe = await newPhone('bob');
  void bobProbe;
  check('a taken handle is refused', (await rejects(() => setUsername('bob', 'alice_w'))) !== null);
  fakeDb.failNext = { match: /^users\/alice$/, code: 'unavailable' };
  check('presence write failure never throws', (await rejects(() => setPresence('alice', { online: true, lastSeen: 1 }))) === null);
  check('first login publishes a prekey pool', poolSize('alice') === 50);

  // ---------------------------------------------------------------- messages
  section('Send / receive end to end');
  resetWorld();
  let alice = await newPhone('alice');
  let bob = await newPhone('bob');
  const chatId = await ensureDirectChat('alice', 'bob');
  check('direct chat id is the sorted uid pair', chatId === 'alice_bob' || chatId === 'alice__bob' || chatId.includes('alice') && chatId.includes('bob'));
  const members = ['alice', 'bob'];

  await useDevice('alice');
  const SECRET = 'meet at 5 — super secret नमस्ते 😀';
  const sent = await sendMessage(alice.mgr, { chatId, senderId: 'alice', memberIds: members, kind: 'text', text: SECRET });
  const everything = JSON.stringify([...fakeDb.docs.entries()]);
  check('server holds NO plaintext anywhere (messages, previews, profiles)', !everything.includes('super secret') && !everything.includes('नमस्ते'));
  check('chat preview is a placeholder', (fakeDb.docs.get(`chats/${chatId}`) as any).lastMessagePreview === 'Message');
  check('the envelope for bob exists, none for alice', !!asMsg(chatId, sent.messageId).envelopes.bob && !asMsg(chatId, sent.messageId).envelopes.alice);
  check('document id is the client id (idempotent retries)', sent.messageId.length >= 8);
  check('alice reads her own message from the local cache', (await decryptMessage(alice.mgr, asMsg(chatId, sent.messageId), 'alice')).text === SECRET);

  await useDevice('bob');
  const poolBefore = poolSize('bob');
  const got = await decryptMessage(bob.mgr, asMsg(chatId, sent.messageId), 'bob');
  check('bob decrypts, including Devanagari and emoji', got.decrypted && got.text === SECRET);
  await sleep(10);
  check('the used one-time prekey is deleted from the server', poolSize('bob') === poolBefore - 1);
  const again = await decryptMessage(bob.mgr, asMsg(chatId, sent.messageId), 'bob');
  check('reading it again uses the cache (ratchet is spent)', again.decrypted && again.text === SECRET);

  await flushPlaintextCache();
  resetPlaintextCacheForTests();
  await warmPlaintextCache();
  check('plaintext cache survives an app restart (stored encrypted)', getPlaintextSync(sent.messageId) === SECRET);

  // ---------------------------------------------------------------- receipts
  section('Receipts write to nested fields');
  await markDelivered(chatId, sent.messageId, 'bob');
  let r = (fakeDb.docs.get(`chats/${chatId}/messages/${sent.messageId}`) as any).receipts;
  check('delivered is stored as receipts.bob (nested, not a dotted field name)', r.bob === 'delivered' && !('receipts.bob' in (fakeDb.docs.get(`chats/${chatId}/messages/${sent.messageId}`) as any)));
  await markRead(chatId, sent.messageId, 'bob');
  r = (fakeDb.docs.get(`chats/${chatId}/messages/${sent.messageId}`) as any).receipts;
  check('read overrides delivered; sender entry untouched', r.bob === 'read' && r.alice === 'sent');

  section('Delivered-on-arrival and background ingest');
  await useDevice('alice');
  const s2 = await sendMessage(alice.mgr, { chatId, senderId: 'alice', memberIds: members, kind: 'text', text: 'second' });
  const s3 = await sendMessage(alice.mgr, { chatId, senderId: 'alice', memberIds: members, kind: 'text', text: 'third' });
  await useDevice('bob');
  await ackUndelivered(chatId, 'bob');
  check('ack marks every unseen message delivered', ['second', 'third'].length === 2 && (asMsg(chatId, s2.messageId).receipts.bob === 'delivered') && (asMsg(chatId, s3.messageId).receipts.bob === 'delivered'));
  await ingestRecent(bob.mgr, chatId, 'bob');
  check('background ingest decrypts into the cache (list previews work)', getPlaintextSync(s3.messageId) === 'third' && getPlaintextSync(s2.messageId) === 'second');

  // ---------------------------------------------------------------- read cursors
  section('Read cursors only move forward');
  check('first advance writes', (await setLastRead(chatId, 'bob', 100, 0)) === true);
  check('a regression is skipped client-side', (await setLastRead(chatId, 'bob', 50, 100)) === false);
  check('cursor stored under lastReadAt.bob', (fakeDb.docs.get(`chats/${chatId}`) as any).lastReadAt.bob === 100);

  // ---------------------------------------------------------------- recovery via resend
  section('First message with a stale one-time prekey recovers via resend');
  resetWorld();
  alice = await newPhone('alice');
  bob = await newPhone('bob');
  const cid2 = await ensureDirectChat('alice', 'bob');
  // Simulate the original bug: the server still advertises a prekey bob no longer has.
  for (const k of [...fakeDb.docs.keys()].filter((k) => k.startsWith('users/bob/prekeys/'))) fakeDb.docs.delete(k);
  fakeDb.docs.set('users/bob/prekeys/9999', { id: 9999, publicKey: alice.mgr.getPublicPreKeys().oneTimePreKeys[0]!.publicKey });
  await useDevice('alice');
  const m1 = await sendMessage(alice.mgr, { chatId: cid2, senderId: 'alice', memberIds: members, kind: 'text', text: 'hello after trouble' });
  await useDevice('bob');
  const bad = await decryptMessage(bob.mgr, asMsg(cid2, m1.messageId), 'bob');
  check('bob cannot read it, and is told why', !bad.decrypted && bad.decryptIssue === 'failed');
  check('no session was left behind', !bob.mgr.hasSession('alice'));
  await requestResend(cid2, 'bob', 'alice', [m1.messageId], true);
  await useDevice('alice');
  let requests: any[] = [];
  const unsub = subscribeResendRequests(cid2, (rows) => (requests = rows));
  await sleep(15);
  unsub();
  check('alice sees the request addressed to her', requests.length === 1 && requests[0].senderUid === 'alice' && requests[0].id === resendRequestId('bob', 'alice'));
  const served = await serveResendRequests(alice.mgr, cid2, 'alice', requests);
  check('alice re-sends the message', served === 1);
  check('the request is cleared', !fakeDb.docs.has(`chats/${cid2}/resendRequests/${resendRequestId('bob', 'alice')}`));
  check('the re-sent envelope uses the signed prekey only', asMsg(cid2, m1.messageId).envelopes.bob!.header.usedPreKeyId == null);
  await useDevice('bob');
  const fixed = await decryptMessage(bob.mgr, asMsg(cid2, m1.messageId), 'bob');
  check('bob now reads it', fixed.decrypted && fixed.text === 'hello after trouble');
  check('a request addressed to someone else is ignored', (await serveResendRequests(alice.mgr, cid2, 'alice', [{ id: 'x', requesterUid: 'bob', senderUid: 'carol', at: Date.now(), messageIds: [m1.messageId], reset: true }])) === 0);

  // ---------------------------------------------------------------- history key
  section('Own history survives a reinstall');
  resetWorld();
  alice = await newPhone('alice');
  bob = await newPhone('bob');
  const cid3 = await ensureDirectChat('alice', 'bob');
  await useDevice('alice');
  check('first sign-in creates a history key', (await unlockHistoryKey('alice', 'correct horse')) === 'created');
  check('the wrapped key is stored, plaintext key is not', JSON.stringify(fakeDb.docs.get('users/alice/backup/history')).includes('wrapped'));
  const hs = await sendMessage(alice.mgr, { chatId: cid3, senderId: 'alice', memberIds: members, kind: 'text', text: 'my own history 😀 हिंदी' });
  check('message carries a self-envelope', !!asMsg(cid3, hs.messageId).selfEnvelope);
  check('the self-envelope is not readable plaintext', !JSON.stringify(asMsg(cid3, hs.messageId).selfEnvelope).includes('history'));

  await useDevice('alice', { fresh: true }); // reinstall: empty storage
  resetPlaintextCacheForTests();
  const lost = await decryptMessage(alice.mgr, asMsg(cid3, hs.messageId), 'alice');
  check('without the key the old message is unavailable', !lost.decrypted && lost.decryptIssue === 'unavailable');
  check('a WRONG password cannot restore it', (await unlockHistoryKey('alice', 'wrong password')) === 'mismatch');
  check('the right password restores the key', (await unlockHistoryKey('alice', 'correct horse')) === 'restored');
  const back = await decryptMessage(alice.mgr, asMsg(cid3, hs.messageId), 'alice');
  check('own history reads again after reinstall', back.decrypted && back.text === 'my own history 😀 हिंदी');

  // ---------------------------------------------------------------- outbox
  section('Outbox: sending / failed / retry');
  resetWorld();
  alice = await newPhone('alice');
  bob = await newPhone('bob');
  const cid4 = await ensureDirectChat('alice', 'bob');
  await useDevice('alice');
  let seen: ReturnType<typeof getOutbox> = [];
  subscribeOutbox((i) => (seen = i));
  await sleep(5);
  const p = (text: string) => ({ chatId: cid4, senderId: 'alice', memberIds: members, kind: 'text' as const, text });
  await flush(alice.mgr);

  // offline: the write is queued by Firestore, the UI sees 'sending', and it finishes on reconnect.
  fakeDb.goOffline();
  const off = await enqueue(p('written while offline'));
  await sleep(30);
  check('offline message shows as sending (not stuck, not lost)', getOutbox().some((i) => i.id === off.id && i.state === 'sending'));
  check('the document is already in the local Firestore cache as a pending write', fakeDb.pending.has(`chats/${cid4}/messages/${off.id}`));
  fakeDb.goOnline();
  await sleep(30);
  check('after reconnect the outbox is empty', getOutbox().length === 0);
  check('exactly one message document exists', messageDocs(cid4).length === 1);

  // server rejects the write -> failed with a friendly reason, retry succeeds, still one document.
  fakeDb.failNext = { match: new RegExp(`^chats/${cid4}/messages/`), code: 'permission-denied' };
  const bad2 = await enqueue(p('will be rejected once'));
  await sleep(30);
  const failed = getOutbox().find((i) => i.id === bad2.id);
  check('a rejected send is marked failed', failed?.state === 'failed');
  check('with a friendly reason (no raw error text)', failed?.friendlyError === 'You don’t have permission to do that.');
  check('the failure is visible to subscribers (UI can show Retry)', seen.some((i) => i.state === 'failed'));
  const ratchetBefore = JSON.stringify(alice.mgr.sessionPeerIdentityKey('bob'));
  await retry(bad2.id);
  await sleep(30);
  check('Retry succeeds and clears the outbox', getOutbox().length === 0);
  check('retry reused the prepared ciphertext (still one doc per message)', messageDocs(cid4).length === 2);
  void ratchetBefore;

  // a message that can't even be prepared (peer has no keys yet) survives an app restart.
  const noKeys = await ensureDirectChat('alice', 'carol');
  const stuck = await enqueue({ chatId: noKeys, senderId: 'alice', memberIds: ['alice', 'carol'], kind: 'text', text: 'carol is not set up yet' });
  await sleep(30);
  check('unreachable recipient => failed with a friendly message', getOutbox().find((i) => i.id === stuck.id)?.friendlyError === 'We couldn’t find that person.');
  await newPhone('carol'); // carol finishes setting up (switches phones…)
  await useDevice('alice'); // …and back: a cold start of alice's app (outbox reloaded from storage)
  let restored: ReturnType<typeof getOutbox> = [];
  subscribeOutbox((i) => (restored = i));
  await sleep(10);
  check('the queue is restored from encrypted storage after restart', restored.some((i) => i.id === stuck.id));
  check('and it is stored sealed, not as plain text', !readStorage().some((v) => v.includes('carol is not set up yet')));
  await flush(alice.mgr);
  await sleep(30);
  check('once the recipient exists, the restored message goes out', messageDocs(noKeys).length === 1 && !getOutbox().some((i) => i.id === stuck.id));

  const dropMe = await enqueue(p('x'.repeat(3)));
  fakeDb.failNext = null;
  await discard(dropMe.id);
  check('Discard removes a message from the outbox', !getOutbox().some((i) => i.id === dropMe.id));

  // ---------------------------------------------------------------- groups
  section('Groups: one unreachable member does not block everyone');
  resetWorld();
  alice = await newPhone('alice');
  bob = await newPhone('bob');
  const gid = await createGroup('alice', ['bob', 'dave'], 'Team');
  await useDevice('alice');
  const gm = await sendMessage(alice.mgr, { chatId: gid, senderId: 'alice', memberIds: ['alice', 'bob', 'dave'], kind: 'text', text: 'hi team' });
  check('reachable members get an envelope', !!asMsg(gid, gm.messageId).envelopes.bob);
  check('the unreachable member is reported, not fatal', gm.skipped.join() === 'dave');
  check('sending to ONLY unreachable people fails loudly', (await rejects(() => sendMessage(alice.mgr, { chatId: gid, senderId: 'alice', memberIds: ['alice', 'dave'], kind: 'text', text: 'x' }))) !== null);

  // ---------------------------------------------------------------- pagination
  section('Pagination');
  resetWorld();
  for (let i = 0; i < 120; i++) {
    fakeDb.docs.set(`chats/pg/messages/m${String(i).padStart(3, '0')}`, { createdAt: i, senderId: 'a', kind: 'text', envelopes: {}, receipts: {} });
  }
  let page: Message[] = [];
  let more = false;
  let stop = subscribeMessages('pg', (m, info) => ((page = m), (more = info.hasMore)));
  await sleep(10);
  stop();
  check(`first page is the newest ${PAGE_SIZE}, oldest first`, page.length === PAGE_SIZE && page[0]!.createdAt === 70 && page[page.length - 1]!.createdAt === 119);
  check('hasMore is true while older messages exist', more);
  stop = subscribeMessages('pg', (m, info) => ((page = m), (more = info.hasMore)), PAGE_SIZE * 3);
  await sleep(10);
  stop();
  check('a wider window returns everything, in order', page.length === 120 && page[0]!.createdAt === 0);
  check('hasMore is false at the start of history', !more);

  // ---------------------------------------------------------------- typing
  section('Typing and presence are best-effort');
  fakeDb.failNext = { match: /typing/, code: 'unavailable' };
  check('a failed typing write does not throw', (await rejects(() => setTyping('pg', 'a', true))) === null);

  section('No Firestore transactions anywhere');
  check('fake db would throw on runTransaction', (await rejects(async () => fakeDb.runTransaction())) !== null);

  finish('services');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
