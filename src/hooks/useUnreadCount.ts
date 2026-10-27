import { useEffect, useState } from 'react';
import { countUnreadMessages } from '@/services/messages';
import type { ChatId, UserId } from '@/types';

/**
 * Live-ish unread count for one chat row: messages from other people newer
 * than the reader's read cursor. Returns null while the count is loading (the
 * row shows the plain dot meanwhile) and 0 when nothing is unread, so the
 * caller never has to guess whether "no number" means "loading" or "read".
 *
 * It re-counts whenever the cursor or the newest message moves: a new message
 * bumps the number, opening the chat (or marking it read) clears it. It does
 * not subscribe per row — a count query on each change is cheaper than a
 * listener per chat in the list.
 */
export function useUnreadCount(
  chatId: ChatId,
  myUid: UserId,
  lastReadAt: number,
  lastMessageAt: number,
  enabled: boolean,
): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled || lastMessageAt <= lastReadAt) {
      setCount(0);
      return;
    }
    let live = true;
    countUnreadMessages(chatId, myUid, lastReadAt)
      .then((n) => {
        if (live) setCount(n);
      })
      .catch(() => {
        if (live) setCount(null);
      });
    return () => {
      live = false;
    };
  }, [chatId, myUid, lastReadAt, lastMessageAt, enabled]);

  return count;
}
