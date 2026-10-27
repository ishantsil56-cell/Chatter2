/**
 * Phase 1.1 admin checks: the server-enforced group admin work.
 * Runs the REAL chats.ts code against the in-memory Firestore (see
 * harness.ts / fakeFirestore.ts). This verifies the CLIENT half: the
 * legacy-aware admin checks and the system-message sender fix. The
 * RULES half is verified separately against the Firestore emulator
 * (the fake DB here is not a rules engine, by its own comment).
 *
 * Run as part of: npm run test:services (imported by run.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fakeDb, resetWorld } from './harness';
import { check, section, rejects } from './check';
import {
  createGroup,
  addMembers,
  removeMember,
  leaveGroup,
  renameGroup,
  promoteToAdmin,
  getChat,
} from '../chats';

const sysMessages = (chatId: string): Record<string, any>[] =>
  [...fakeDb.docs.entries()]
    .filter(([k]) => k.startsWith(`chats/${chatId}/messages/`))
    .map(([, v]) => v as Record<string, any>)
    .filter((m) => m.kind === 'system');

export async function runAdminChecks(): Promise<void> {
  section('Phase 1.1: group admin checks (client half)');

  // ------------------------------------------------------------ admin chat
  resetWorld();
  const g1 = await createGroup('alice', ['bob', 'carol'], 'G1');
  let chat = await getChat(g1);
  check('createGroup sets the creator as sole admin', JSON.stringify(chat?.adminIds) === JSON.stringify(['alice']));
  check(
    'group-created system message is sent by the creator, not a literal system sender',
    sysMessages(g1).some((m) => m.senderId === 'alice' && m.systemText === 'G1 created'),
  );

  // Adding is collaborative by product intent: any member may add.
  await addMembers(g1, ['dave'], 'bob');
  chat = await getChat(g1);
  check('a non-admin member can add members', chat?.memberIds.includes('dave') === true);
  check(
    'member-added system message is sent by the acting member',
    sysMessages(g1).some((m) => m.senderId === 'bob' && (m.systemText as string).includes('member(s) added')),
  );

  // Removing is admin-only.
  const removeErr = await rejects(() => removeMember(g1, 'carol', 'bob'));
  check('a non-admin cannot remove another member', removeErr !== null && String(removeErr).includes('only admins'));
  chat = await getChat(g1);
  check('failed removal leaves membership untouched', chat?.memberIds.includes('carol') === true);
  await removeMember(g1, 'carol', 'alice');
  chat = await getChat(g1);
  check('an admin can remove a member', chat?.memberIds.includes('carol') === false);
  check(
    'member-removed system message is sent by the acting admin',
    sysMessages(g1).some((m) => m.senderId === 'alice' && m.systemText === 'A member was removed'),
  );

  // Renaming is admin-only.
  const renameErr = await rejects(() => renameGroup(g1, 'Nope', 'bob'));
  check('a non-admin cannot rename the group', renameErr !== null && String(renameErr).includes('only admins'));
  chat = await getChat(g1);
  check('failed rename leaves the name untouched', chat?.name === 'G1');
  await renameGroup(g1, 'G1 Renamed', 'alice');
  chat = await getChat(g1);
  check('an admin can rename the group', chat?.name === 'G1 Renamed');

  // Promoting is admin-only, and a promoted member gains admin power.
  const promoteErr = await rejects(() => promoteToAdmin(g1, 'dave', 'bob'));
  check('a non-admin cannot promote members', promoteErr !== null && String(promoteErr).includes('only admins'));
  chat = await getChat(g1);
  check('failed promotion leaves adminIds untouched', JSON.stringify(chat?.adminIds) === JSON.stringify(['alice']));
  await promoteToAdmin(g1, 'bob', 'alice');
  chat = await getChat(g1);
  check('an admin can promote a member', chat?.adminIds.includes('bob') === true);
  await removeMember(g1, 'dave', 'bob');
  chat = await getChat(g1);
  check('a newly promoted admin can remove members', chat?.memberIds.includes('dave') === false);

  // ------------------------------------------------------------ legacy chat
  // Chats created before adminIds existed carry no adminIds field: the
  // client checks (like the rules) stay permissive for them.
  resetWorld();
  fakeDb.docs.set('chats/legacy1', {
    id: 'legacy1',
    kind: 'group',
    name: 'Legacy',
    photoURL: null,
    memberIds: ['alice', 'bob', 'carol'],
    lastReadAt: { alice: 0, bob: 0, carol: 0 },
    lastMessageAt: 1,
    lastMessagePreview: '',
    createdAt: 1,
    updatedAt: 1,
  });
  await removeMember('legacy1', 'carol', 'bob');
  chat = await getChat('legacy1');
  check('legacy chat (no adminIds): a member can still remove', chat?.memberIds.includes('carol') === false);
  await renameGroup('legacy1', 'Legacy Renamed', 'bob');
  chat = await getChat('legacy1');
  check('legacy chat (no adminIds): a member can still rename', chat?.name === 'Legacy Renamed');

  // ------------------------------------------------------------ leaving
  resetWorld();
  const g2 = await createGroup('alice', ['bob', 'carol'], 'G2');
  await leaveGroup(g2, 'bob');
  chat = await getChat(g2);
  check('leaving removes only the leaver from members', chat?.memberIds.includes('bob') === false && chat?.memberIds.includes('alice') === true);
  check(
    'member-left system message is sent by the leaver',
    sysMessages(g2).some((m) => m.senderId === 'bob' && m.systemText === 'A member left'),
  );
  await leaveGroup(g2, 'alice');
  chat = await getChat(g2);
  check(
    'an admin leaving drops them from adminIds too',
    chat?.memberIds.includes('alice') === false && (chat?.adminIds ?? []).includes('alice') === false,
  );
}
