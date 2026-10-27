import { useEffect, useState } from 'react';
import { subscribeReactions } from '@/services/reactions';
import { subscribeVotes } from '@/services/polls';
import type { ChatId, MessageId } from '@/types';
import type { PollVote, Reaction } from '@/types/extended';

/** Live reactions for one message. Empty array until the first snapshot. */
export function useMessageReactions(chatId: ChatId, messageId: MessageId): Reaction[] {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  useEffect(
    () => subscribeReactions(chatId, messageId, setReactions, () => undefined),
    [chatId, messageId],
  );
  return reactions;
}

/** Live votes for one poll message. Empty array until the first snapshot. */
export function usePollVotes(chatId: ChatId, messageId: MessageId): PollVote[] {
  const [votes, setVotes] = useState<PollVote[]>([]);
  useEffect(() => subscribeVotes(chatId, messageId, setVotes, () => undefined), [chatId, messageId]);
  return votes;
}
