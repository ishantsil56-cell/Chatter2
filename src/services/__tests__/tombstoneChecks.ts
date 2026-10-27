/**
 * Phase 1.3 delete-for-everyone tombstone checks: the sender blanks the
 * content on the server and every client renders a tombstone instead.
 * Runs the REAL messages.ts code against the in-memory Firestore.
 *
 * Run as part of: npm run test:services (imported by run.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fakeDb, resetWorld } from './harness';
import { check, section } from './check';
import { deleteMessage, decryptMessage } from '../messages';
import { putPlaintext } from '../messageCache';
import { SessionManager } from '../crypto/session';
import { InMemoryKeyStore } from '../crypto/store';

const chatDoc = (chatId: string): Record<string, any> =>
  fakeDb.docs.get(`chats/${chatId}`) as Record<string, any>;
const msgDoc = (chatId: string, id: string): Record<string, any> =>
  fakeDb.docs.get(`chats/${chatId}/messages/${id}`) as Record<string, any>;

function seedChat(chatId: string, lastMessageId: string, preview: string): void {
  fakeDb.docs.set(`chats/${chatId}`, {
    id: chatId,
    kind: 'group',
    name: 'G',
    memberIds: ['alice', 'bob'],
    lastReadAt: { alice: 0, bob: 0 },
    lastMessageAt: 100,
    lastMessagePreview: preview,
    lastMessageId,
    createdAt: 1,
    updatedAt: 100,
  });
}

function seedMessage(chatId: string, id: string): void {
  fakeDb.docs.set(`chats/${chatId}/messages/${id}`, {
    id,
    chatId,
    senderId: 'alice',
    kind: 'image',
    envelopes: { bob: { ciphertext: 'ct', header: {} } },
    selfEnvelope: { nonce: 'n', ciphertext: 'ct' },
    media: { url: 'https://example.invalid/blob', width: 100, height: 100 },
    createdAt: 100,
    receipts: { alice: 'sent', bob: 'sent' },
    clientId: 'c1',
  });
}

export async function runTombstoneChecks(): Promise<void> {
  section('Phase 1.3: delete-for-everyone tombstone (client half)');

  // ------------------------------------------------------------ tombstoning
  resetWorld();
  seedChat('g1', 'm1', 'Photo');
  seedMessage('g1', 'm1');
  await deleteMessage('g1', 'm1');
  let m = msgDoc('g1', 'm1');
  check('tombstone flags the message', m.deletedForEveryone === true && typeof m.deletedAt === 'number');
  check('tombstone blanks the recipient envelopes', JSON.stringify(m.envelopes) === '{}');
  check('tombstone blanks the sender history copy', m.selfEnvelope === null);
  check('tombstone blanks the media descriptor', m.media === null);
  check(
    'tombstone keeps the rest of the document (sender, time, receipts)',
    m.senderId === 'alice' && m.createdAt === 100 && m.receipts.bob === 'sent',
  );
  check(
    'preview becomes the tombstone text when it was the newest message',
    chatDoc('g1').lastMessagePreview === 'This message was deleted',
  );

  // Deleting an older message must not drag the preview backwards.
  resetWorld();
  seedChat('g2', 'm9', 'Newest text');
  seedMessage('g2', 'm1');
  await deleteMessage('g2', 'm1');
  check(
    'preview is untouched when tombstoning an older message',
    chatDoc('g2').lastMessagePreview === 'Newest text',
  );

  // Deleting a message that is already gone is a silent no-op.
  resetWorld();
  seedChat('g3', 'm9', 'Newest text');
  await deleteMessage('g3', 'nope');
  check('deleting a nonexistent message does not throw', true);

  // ------------------------------------------------------------ rendering
  resetWorld();
  const mgr = new SessionManager(new InMemoryKeyStore());
  await mgr.init();
  await putPlaintext('m9', 'stale secret still cached on this device');
  const decrypted = await decryptMessage(
    mgr,
    {
      id: 'm9',
      chatId: 'g9',
      senderId: 'alice',
      kind: 'text',
      envelopes: {},
      selfEnvelope: null,
      media: null,
      createdAt: 1,
      receipts: {},
      clientId: 'c9',
      deletedForEveryone: true,
    } as any,
    'bob',
  );
  check(
    'a tombstoned message decrypts to nothing even with stale cached plaintext',
    decrypted.text === null && decrypted.decrypted === true,
  );
}
