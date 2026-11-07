import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';

export interface AppMenuSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Opens the announcements list. */
  onWhatsNew: () => void;
  /** Opens the Diagnostics Centre. */
  onDiagnostics: () => void;
  /** Shown as the subtitle on the announcements row. */
  whatsNewHint?: string;
  /** Small dot on the announcements row when something has not been read. */
  hasUnread?: boolean;
}

interface RowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  dot?: boolean;
}

function Row({ icon, title, subtitle, onPress, dot }: RowProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={20} color={palette.accent} />
        {dot ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
    </Pressable>
  );
}

/**
 * The menu behind the three dots.
 *
 * Two destinations, deliberately. A menu is not a place to keep everything —
 * every extra row makes the ones that matter harder to find, and the chat list
 * already has a tab bar for navigation.
 */
export function AppMenuSheet({
  visible,
  onClose,
  onWhatsNew,
  onDiagnostics,
  whatsNewHint = 'See what changed',
  hasUnread = false,
}: AppMenuSheetProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        {/* Swallows taps so pressing the sheet itself does not dismiss it. */}
        <Pressable
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <Row
            icon="sparkles-outline"
            title="What's new"
            subtitle={whatsNewHint}
            dot={hasUnread}
            onPress={onWhatsNew}
          />
          <Row
            icon="pulse-outline"
            title="Diagnostics"
            subtitle="Recent errors, app info, and a way to clear them"
            onPress={onDiagnostics}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: palette.border,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  rowPressed: { backgroundColor: palette.surfaceHigh },
  iconWrap: { width: 24, alignItems: 'center' },
  dot: {
    position: 'absolute',
    top: -2,
    right: 0,
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  rowSubtitle: { color: palette.textMuted, fontSize: fontSize.xs, lineHeight: 15 },
});
