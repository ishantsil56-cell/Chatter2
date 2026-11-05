import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { getUserFromCache } from '@/store/userCache';
import type { LedgerItem } from '@/store/ledgerStore';
import type { UserId } from '@/types';

/** Date and time in the phone's own locale, never a hardcoded format. */
function stamp(at: number): string {
  const d = new Date(at);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${date} · ${time}`;
}

function authorName(uid: UserId): string {
  const profile = getUserFromCache(uid);
  return profile?.displayName || profile?.username || 'Someone';
}

export interface LedgerCardProps {
  item: LedgerItem;
  onLongPress: (item: LedgerItem) => void;
}

/**
 * One flashcard.
 *
 * The text is the point, so the card stays quiet: no colour coding by author, no
 * badges. The date and author sit in a footer row, small and secondary, the way
 * a card is annotated rather than titled.
 */
export function LedgerCard({ item, onLongPress }: LedgerCardProps): React.JSX.Element {
  return (
    <Pressable
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Recorded by ${authorName(item.senderId)}, ${stamp(item.createdAt)}`}
      accessibilityHint="Long-press for options"
    >
      <View style={styles.watermark} pointerEvents="none">
        <Ionicons name="eye-outline" size={34} color={palette.accentSoft} />
      </View>

      <Text style={styles.body}>{item.text ?? 'This entry could not be opened on this device.'}</Text>

      <View style={styles.footer}>
        <View style={styles.footerRow}>
          <Ionicons name="calendar-outline" size={13} color={palette.textMuted} />
          <Text style={styles.meta}>{stamp(item.createdAt)}</Text>
        </View>
        <View style={styles.footerRow}>
          <Ionicons name="person-outline" size={13} color={palette.textMuted} />
          <Text style={styles.meta}>{authorName(item.senderId)}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    padding: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardPressed: { backgroundColor: palette.surfaceHigh },
  // A watermark, not a badge: it should be felt rather than read.
  watermark: { position: 'absolute', top: spacing.md, right: spacing.md, opacity: 0.5 },
  body: { color: palette.text, fontSize: fontSize.md, lineHeight: 22, paddingRight: spacing.xl },
  footer: { marginTop: spacing.lg, gap: 4 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { color: palette.textMuted, fontSize: fontSize.xs },
});
