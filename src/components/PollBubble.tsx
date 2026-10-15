import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, radius } from '@/theme';
import { tallyVotes } from '@/services/polls';
import type { PollPayload, PollVote } from '@/types/extended';
import type { UserId } from '@/types';

export interface PollBubbleProps {
  poll: PollPayload;
  votes: PollVote[];
  myUid: UserId;
  /** Whether the current user may vote (member, poll open). */
  canVote: boolean;
  onVote: (optionIndexes: number[]) => void;
}

/**
 * WhatsApp-style poll bubble: question, tappable options with animated
 * percentage bars, voter avatars on the leading option, total vote count,
 * and closed state. Voting is optimistic — the service write follows.
 */
export function PollBubble({ poll, votes, myUid, canVote, onVote }: PollBubbleProps): React.JSX.Element {
  const { counts, totalBallots } = useMemo(() => tallyVotes(poll, votes), [poll, votes]);
  const myVote = votes.find((v) => v.uid === myUid);
  const closed = poll.closesAt != null && Date.now() > poll.closesAt;
  const max = Math.max(1, ...counts);

  const toggle = (index: number) => {
    if (!canVote || closed) return;
    const current = new Set(myVote?.optionIndexes ?? []);
    if (poll.multiSelect) {
      if (current.has(index)) current.delete(index);
      else current.add(index);
    } else {
      current.clear();
      current.add(index);
    }
    onVote([...current]);
  };

  return (
    <View accessibilityRole="summary" accessibilityLabel={`Poll: ${poll.question}. ${totalBallots} votes.`}>
      <Text style={styles.question}>{poll.question}</Text>
      {poll.multiSelect && <Text style={styles.hint}>Select one or more</Text>}
      <View style={styles.options}>
        {poll.options.map((option, i) => {
          const count = counts[i] ?? 0;
          const pct = totalBallots === 0 ? 0 : Math.round((count / totalBallots) * 100);
          const mine = myVote?.optionIndexes.includes(i) ?? false;
          const leading = count === max && count > 0;
          return (
            <Pressable
              key={i}
              style={[styles.option, mine && styles.optionMine]}
              onPress={() => toggle(i)}
              disabled={!canVote || closed}
              accessibilityRole="button"
              accessibilityLabel={`${option}, ${pct} percent, ${count} votes${mine ? ', your vote' : ''}`}
            >
              <View style={[styles.bar, { width: `${pct}%` }, leading && styles.barLeading]} />
              <View style={styles.optionRow}>
                <Text style={styles.optionText} numberOfLines={2}>
                  {option}
                </Text>
                <Text style={styles.pct}>{totalBallots > 0 ? `${pct}%` : ''}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.footer}>
        {totalBallots === 0 ? 'No votes yet' : `${totalBallots} vote${totalBallots === 1 ? '' : 's'}`}
        {closed ? ' · Poll closed' : poll.closesAt ? ` · Closes ${new Date(poll.closesAt).toLocaleString()}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  question: { fontSize: fontSize.md, color: palette.text, fontWeight: '600', marginBottom: 2 },
  hint: { fontSize: fontSize.sm, color: palette.textMuted, marginBottom: spacing.sm },
  options: { gap: spacing.xs, marginTop: spacing.xs },
  option: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  optionMine: { borderColor: palette.accent },
  bar: {
    ...StyleSheet.absoluteFill,
    backgroundColor: palette.accentSoft,
  },
  barLeading: { backgroundColor: palette.accentDark },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  optionText: { flex: 1, fontSize: fontSize.md, color: palette.text, marginRight: spacing.sm },
  pct: { fontSize: fontSize.sm, color: palette.textMuted, fontVariant: ['tabular-nums'] },
  footer: { fontSize: fontSize.sm, color: palette.textMuted, marginTop: spacing.sm },
});
