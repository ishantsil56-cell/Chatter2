/**
 * Item 2 chat-preference checks: pin, mute, star and mark-unread live in a
 * per-user doc — never on the shared chat document — and the subscription
 * follows writes.
 *
 * Run as part of: npm run test:services (imported by run.ts).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fakeDb, resetWorld, sleep } from './harness';
import { check, section } from './check';
import { subscribeChatPrefs, setPinned, setMuted, setStarred, markUnread, clearUnread } from '../chatPrefs';

export async function runPrefsChecks(): Promise<void> {
  section('Item 2: per-user chat prefs');

  resetWorld();
  await setPinned('alice', 'c1', true);
  check(
    'pin writes a per-user doc, not the chat doc',
    (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.pinnedAt != null &&
      fakeDb.docs.get('chats/c1') === undefined,
  );
  await setPinned('alice', 'c1', false);
  check('unpin clears the timestamp', (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.pinnedAt === null);
  await setMuted('alice', 'c1', true);
  check('mute writes', (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.muted === true);
  await setStarred('alice', 'c1', true);
  check('star writes alongside mute', (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.starred === true);
  await markUnread('alice', 'c1');
  check('mark-unread sets the override', (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.unread === true);
  await clearUnread('alice', 'c1');
  check('clear-unread removes the override', (fakeDb.docs.get('users/alice/chatPrefs/c1') as any)?.unread === false);
  check(
    'bob has no prefs doc for alice’s chat',
    fakeDb.docs.get('users/bob/chatPrefs/c1') === undefined,
  );

  let seen: Record<string, any> = {};
  const off = subscribeChatPrefs('alice', (prefs) => {
    seen = prefs;
  });
  await sleep(10);
  check(
    'subscribeChatPrefs delivers the map',
    seen['c1']?.muted === true && seen['c1']?.starred === true,
  );
  await setMuted('alice', 'c1', false);
  await sleep(10);
  check('subscription follows a mute change', seen['c1']?.muted === false);
  off();
}
