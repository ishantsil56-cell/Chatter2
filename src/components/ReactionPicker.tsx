import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, radius } from '@/theme';
import { QUICK_REACTIONS } from '@/services/reactions';

export interface ReactionPickerProps {
  visible: boolean;
  /** Emoji the current user already set on this message, if any. */
  current?: string | null;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

/**
 * WhatsApp-style quick reaction tray: the six defaults plus a "+" that opens
 * the full emoji keyboard (host app wires `onPick('+')` to its emoji picker).
 * Rendered by ChatScreen above the long-pressed bubble.
 */
export function ReactionPicker({ visible, current, onPick, onClose }: ReactionPickerProps): React.JSX.Element | null {
  if (!visible) return null;
  return (
    <Pressable
      style={styles.backdrop}
      onPress={onClose}
      accessibilityRole="button"
      accessibilityLabel="Close reactions"
    >
      <View style={styles.tray} accessibilityRole="menu" accessibilityLabel="React to message">
        {QUICK_REACTIONS.map((emoji) => {
          const active = current === emoji;
          return (
            <Pressable
              key={emoji}
              style={[styles.emoji, active && styles.emojiActive]}
              onPress={() => onPick(emoji)}
              accessibilityRole="menuitem"
              accessibilityLabel={`React with ${emoji}${active ? ', currently selected' : ''}`}
            >
              <Text style={styles.glyph}>{emoji}</Text>
            </Pressable>
          );
        })}
        <Pressable
          style={styles.emoji}
          onPress={() => onPick('+')}
          accessibilityRole="menuitem"
          accessibilityLabel="More emoji"
        >
          <Text style={styles.glyph}>＋</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export interface ReactionSummaryProps {
  summary: { emoji: string; count: number }[];
  onPress: () => void;
}

/** The little pill under a bubble showing reaction counts. */
export function ReactionSummary({ summary, onPress }: ReactionSummaryProps): React.JSX.Element | null {
  if (summary.length === 0) return null;
  const total = summary.reduce((n, s) => n + s.count, 0);
  return (
    <Pressable
      style={styles.summary}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${summary.map((s) => `${s.count} ${s.emoji}`).join(', ')} reactions. Tap for details.`}
    >
      {summary.slice(0, 3).map((s) => (
        <Text key={s.emoji} style={styles.summaryGlyph}>
          {s.emoji}
        </Text>
      ))}
      <Text style={styles.summaryCount}>{total}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(4,6,12,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 50,
  },
  tray: {
    flexDirection: 'row',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: palette.border,
  },
  emoji: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiActive: {
    backgroundColor: palette.accentSoft,
    borderWidth: 1,
    borderColor: palette.accent,
  },
  glyph: { fontSize: 26 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginTop: 2,
    borderWidth: 1,
    borderColor: palette.border,
  },
  summaryGlyph: { fontSize: 14, marginRight: 2 },
  summaryCount: { fontSize: fontSize.sm, color: palette.textMuted, marginLeft: 2 },
});
