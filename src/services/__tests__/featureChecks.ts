/**
 * Restored feature checks (item 1): polls, reactions, disappearing messages,
 * edit, delete-for-me, and the ephemeral capture in the send path.
 * Runs the REAL services against the in-memory Firestore.
 *
 * Run as part of: npm run test:services (imported by run.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fakeDb, resetWorld, useDevice, sleep } from './harness';
import { check, section, rejects } from './check';
import { validatePoll, tallyVotes, encodePollBody, decodePollBody, vote, retractVote, subscribeVotes } from '../polls';
import { toggleReaction, summarizeReactions, subscribeReactions } from '../reactions';
import {
  EPHEMERAL_24H,
  setEphemeralTtl,
  ttlLabel,
  isExpired,
  canEditMessage,
  canDeleteForEveryone,
  editMessage,
  EDIT_WINDOW_MS,
  DELETE_WINDOW_MS,
} from '../disappearing';
import { isDeletedLocally, markDeletedLocally, loadLocalDeletes } from '../localDeletes';
import { sendMessage, prepareMessage, previewFor } from '../messages';
import { ensureDirectChat } from '../chats';
import { SessionManager } from '../crypto/session';
import { InMemoryKeyStore } from '../crypto/store';
import { b64 } from '../crypto/primitives';
import { ensureProfile } from '../users';
import { publishPreKeys, deletePublishedPreKey } from '../prekeys';
import type { PollPayload } from '../../types/extended';

const POLL: PollPayload = {
  question: 'Where next?',
  options: ['North', 'South'],
  closesAt: null,
  multiSelect: false,
};

async function newPhone(uid: string) {
  useDevice(uid);
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
  return { uid, mgr };
}

export async function runFeatureChecks(): Promise<void> {
  section('Item 1: polls (pure)');

  check('validatePoll rejects an empty question', validatePoll({ ...POLL, question: '  ' }) !== null);
  check('validatePoll needs two options', validatePoll({ ...POLL, options: ['Only'] }) !== null);
  check('validatePoll rejects duplicate options', validatePoll({ ...POLL, options: ['A', 'a'] }) !== null);
  check('validatePoll rejects a past deadline', validatePoll({ ...POLL, closesAt: Date.now() - 1000 }) !== null);
  check('validatePoll accepts a good poll', validatePoll(POLL) === null);
  const body = encodePollBody(POLL);
  const back = decodePollBody(body);
  check('poll body round-trips', back?.question === 'Where next?' && back?.options.length === 2);
  check('decodePollBody rejects non-poll text', decodePollBody('hello') === null && decodePollBody('{"type":"text"}') === null);
  const tally = tallyVotes(POLL, [
    { uid: 'a', optionIndexes: [0], createdAt: 1 },
    { uid: 'b', optionIndexes: [1], createdAt: 2 },
    { uid: 'c', optionIndexes: [0, 1], createdAt: 3 },
  ]);
  check('tallyVotes counts per option', tally.counts[0] === 2 && tally.counts[1] === 2 && tally.totalBallots === 3);
  check("previewFor('poll') is Poll", previewFor('poll') === 'Poll');

  section('Item 1: poll votes + reactions (fake db)');

  resetWorld();
  fakeDb.docs.set('chats/c1', { memberIds: ['alice', 'bob'], kind: 'direct' });
  fakeDb.docs.set('chats/c1/messages/m1', { senderId: 'alice', kind: 'poll' });
  await vote('c1', 'm1', 'alice', [0], POLL);
  check('vote writes the ballot', (fakeDb.docs.get('chats/c1/messages/m1/votes/alice') as any)?.optionIndexes[0] === 0);
  await vote('c1', 'm1', 'alice', [1], POLL);
  check('a changed vote overwrites', (fakeDb.docs.get('chats/c1/messages/m1/votes/alice') as any)?.optionIndexes[0] === 1);
  check(
    'single-choice poll refuses two options',
    (await rejects(() => vote('c1', 'm1', 'bob', [0, 1], POLL))) !== null,
  );
  check(
    'closed poll refuses votes',
    (await rejects(() => vote('c1', 'm1', 'bob', [0], { ...POLL, closesAt: Date.now() - 1000 }))) !== null,
  );
  await retractVote('c1', 'm1', 'alice');
  check('retractVote removes the ballot', fakeDb.docs.get('chats/c1/messages/m1/votes/alice') === undefined);
  let votesSeen: unknown[] = [];
  const offVotes = subscribeVotes('c1', 'm1', (v) => {
    votesSeen = v;
  });
  await vote('c1', 'm1', 'bob', [0], POLL);
  await sleep(10);
  check('subscribeVotes delivers live ballots', votesSeen.length === 1);
  offVotes();

  await toggleReaction('c1', 'm1', 'alice', '❤️');
  check('reaction writes', (fakeDb.docs.get('chats/c1/messages/m1/reactions/alice') as any)?.emoji === '❤️');
  await toggleReaction('c1', 'm1', 'alice', '❤️');
  check('same emoji twice removes the reaction', fakeDb.docs.get('chats/c1/messages/m1/reactions/alice') === undefined);
  await toggleReaction('c1', 'm1', 'alice', '👍');
  await toggleReaction('c1', 'm1', 'bob', '👍');
  await toggleReaction('c1', 'm1', 'carol', '😂');
  const summary = summarizeReactions([
    { uid: 'alice', emoji: '👍', createdAt: 1 },
    { uid: 'bob', emoji: '👍', createdAt: 2 },
    { uid: 'carol', emoji: '😂', createdAt: 3 },
  ]);
  check(
    'summarizeReactions groups and sorts',
    summary[0].emoji === '👍' && summary[0].count === 2 && summary[1].emoji === '😂',
  );
  let reactionsSeen: unknown[] = [];
  const offReactions = subscribeReactions('c1', 'm1', (r) => {
    reactionsSeen = r;
  });
  await sleep(10);
  check('subscribeReactions delivers live reactions', reactionsSeen.length === 3);
  offReactions();

  section('Item 1: disappearing + edit windows (pure)');

  const now = Date.now();
  check('edit allowed: own text within 15 min', canEditMessage('a', 'a', now, 'text', false) === true);
  check('edit refused: someone else’s', canEditMessage('a', 'b', now, 'text', false) === false);
  check('edit refused: media kind', canEditMessage('a', 'a', now, 'image', false) === false);
  check('edit refused: past the window', canEditMessage('a', 'a', now - EDIT_WINDOW_MS - 1, 'text', false) === false);
  check('edit refused: deleted', canEditMessage('a', 'a', now, 'text', true) === false);
  check('delete-for-everyone allowed within 48h', canDeleteForEveryone('a', 'a', now, false) === true);
  check('delete-for-everyone refused past 48h', canDeleteForEveryone('a', 'a', now - DELETE_WINDOW_MS - 1, false) === false);
  check('isExpired honours the timestamp', isExpired(now - 1) === true && isExpired(now + 1000) === false && isExpired(null) === false);
  check('ttlLabel names the choices', ttlLabel(EPHEMERAL_24H) === '24 hours' && ttlLabel(0) === 'Off');
  check(
    'setEphemeralTtl refuses an unknown timer',
    (await rejects(() => setEphemeralTtl('c1', 12345))) !== null,
  );
  await setEphemeralTtl('c1', EPHEMERAL_24H);
  check(
    'setEphemeralTtl writes the chat timer',
    (fakeDb.docs.get('chats/c1') as any)?.defaultEphemeralTtlMs === EPHEMERAL_24H,
  );
  check(
    'editMessage refuses past the window',
    (await rejects(() => editMessage('c1', 'm1', 'alice', now - EDIT_WINDOW_MS - 1, {}, null))) !== null,
  );
  await editMessage('c1', 'm1', 'alice', now, { bob: { ciphertext: 'x', header: {} } }, { ciphertext: 'y' });
  const edited = fakeDb.docs.get('chats/c1/messages/m1') as any;
  check(
    'editMessage swaps envelopes and stamps editedAt',
    edited?.envelopes?.bob?.ciphertext === 'x' && typeof edited?.editedAt === 'number',
  );

  section('Item 1: delete-for-me (local only)');

  await loadLocalDeletes();
  await loadLocalDeletes();
  check('nothing deleted locally at first', isDeletedLocally('c1', 'm1') === false);
  await markDeletedLocally('c1', 'm1');
  check('markDeletedLocally hides on this device', isDeletedLocally('c1', 'm1') === true);
  check('other messages unaffected', isDeletedLocally('c1', 'm2') === false);
  check(
    'delete-for-me never touches Firestore',
    fakeDb.docs.get('chats/c1/messages/m1') !== undefined,
  );

  section('Item 1: ephemeral capture + poll send (real send path)');

  resetWorld();
  const alice = await newPhone('alice');
  await newPhone('bob');
  const directId = await ensureDirectChat('alice', 'bob');
  const members = ['alice', 'bob'];
  const prepared = await prepareMessage(alice.mgr, {
    chatId: directId,
    senderId: 'alice',
    memberIds: members,
    kind: 'text',
    text: 'vanishing',
    ephemeralTtlMs: EPHEMERAL_24H,
  });
  check(
    'prepareMessage stamps expiresAt from the TTL',
    prepared.doc.ephemeralTtlMs === EPHEMERAL_24H && prepared.doc.expiresAt === prepared.doc.createdAt + EPHEMERAL_24H,
  );
  const plain = await prepareMessage(alice.mgr, {
    chatId: directId,
    senderId: 'alice',
    memberIds: members,
    kind: 'text',
    text: 'staying',
  });
  check('no TTL means no expiry', plain.doc.ephemeralTtlMs === null && plain.doc.expiresAt === null);
  const sent = await sendMessage(alice.mgr, {
    chatId: directId,
    senderId: 'alice',
    memberIds: members,
    kind: 'poll',
    text: encodePollBody(POLL),
    ephemeralTtlMs: EPHEMERAL_24H,
  });
  check('a poll sends through the normal path', sent.messageId.length > 0);
  const pollDoc = [...fakeDb.docs.entries()].find(([k]) => k.startsWith(`chats/${directId}/messages/`))?.[1] as any;
  check(
    'the sent poll carries kind + TTL',
    pollDoc?.kind === 'poll' && pollDoc?.ephemeralTtlMs === EPHEMERAL_24H && typeof pollDoc?.expiresAt === 'number',
  );
}
