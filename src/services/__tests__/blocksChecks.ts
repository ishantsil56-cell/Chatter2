/**
 * Phase 1.4 block list + report checks: the block service writes private
 * docs, the send gates refuse blocked direct chats, groups stay open.
 * Runs the REAL blocks/chats/messages code against the in-memory Firestore.
 *
 * Run as part of: npm run test:services (imported by run.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fakeDb, resetWorld, useDevice, sleep } from './harness';
import { check, section, rejects } from './check';
import { subscribeBlocks, blockUser, unblockUser, isBlocked, reportUser } from '../blocks';
import { ensureDirectChat, createGroup } from '../chats';
import { sendMessage } from '../messages';
import { SessionManager } from '../crypto/session';
import { InMemoryKeyStore } from '../crypto/store';
import { b64 } from '../crypto/primitives';
import { ensureProfile } from '../users';
import { publishPreKeys, deletePublishedPreKey } from '../prekeys';

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

export async function runBlocksChecks(): Promise<void> {
  section('Phase 1.4: block list + report (client half)');

  // ------------------------------------------------------------ block docs
  resetWorld();
  await blockUser('alice', 'bob');
  check('block writes the private doc', (fakeDb.docs.get('users/alice/blocks/bob') as any)?.blockedUid === 'bob');
  check('isBlocked reads it back', (await isBlocked('alice', 'bob')) === true);
  check('blocking is one-directional', (await isBlocked('bob', 'alice')) === false);
  let seen: string[] = [];
  const off = subscribeBlocks('alice', (uids) => {
    seen = uids;
  });
  await sleep(10);
  check('subscribeBlocks delivers the list', seen.join() === 'bob');
  await unblockUser('alice', 'bob');
  await sleep(10);
  check(
    'unblock removes the doc and the subscription follows',
    fakeDb.docs.get('users/alice/blocks/bob') === undefined && seen.length === 0,
  );
  off();
  check('blocking yourself is refused', (await rejects(() => blockUser('alice', 'alice'))) !== null);

  // ------------------------------------------------------------ reports
  await reportUser('alice', 'bob', 'user-report');
  const reports = [...fakeDb.docs.entries()].filter(([k]) => k.startsWith('reports/'));
  check(
    'report files one write-only doc',
    reports.length === 1 &&
      (reports[0][1] as any).reporterUid === 'alice' &&
      (reports[0][1] as any).reportedUid === 'bob',
  );

  // ------------------------------------------------------------ new-chat gate
  resetWorld();
  await blockUser('alice', 'bob');
  check('ensureDirectChat refuses a blocked peer', (await rejects(() => ensureDirectChat('alice', 'bob'))) !== null);
  await unblockUser('alice', 'bob');
  const chatId = await ensureDirectChat('alice', 'bob');
  check('ensureDirectChat works once unblocked', typeof chatId === 'string' && chatId.length > 0);

  // ------------------------------------------------------------ send gate
  resetWorld();
  const alice = await newPhone('alice');
  await newPhone('bob');
  const directId = await ensureDirectChat('alice', 'bob');
  const members = ['alice', 'bob'];
  await blockUser('alice', 'bob');
  check(
    'sending to someone you blocked fails loudly',
    (await rejects(() =>
      sendMessage(alice.mgr, { chatId: directId, senderId: 'alice', memberIds: members, kind: 'text', text: 'hi' }),
    )) !== null,
  );
  await unblockUser('alice', 'bob');
  const sent = await sendMessage(alice.mgr, {
    chatId: directId,
    senderId: 'alice',
    memberIds: members,
    kind: 'text',
    text: 'hi again',
  });
  check('sending works once unblocked', sent.messageId.length > 0);
  const gid = await createGroup('alice', ['alice', 'bob'], 'Team');
  await blockUser('alice', 'bob');
  const gm = await sendMessage(alice.mgr, {
    chatId: gid,
    senderId: 'alice',
    memberIds: ['alice', 'bob'],
    kind: 'text',
    text: 'hi team',
  });
  check('group sends still work with a blocked member', gm.messageId.length > 0);
}
