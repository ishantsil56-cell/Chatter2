import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';

export type MessageActionKey = 'reply' | 'delete' | 'share' | 'forward';

interface ActionRow {
  key: MessageActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
}

const ROWS: ActionRow[] = [
  { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline' },
  { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline' },
  { key: 'share', label: 'Share', icon: 'share-outline' },
  { key: 'delete', label: 'Delete', icon: 'trash-outline', destructive: true },
];

export interface MessageActionSheetProps {
  visible: boolean;
  /** How many messages are selected — drives the heading and the wording. */
  count: number;
  onClose: () => void;
  onAction: (action: MessageActionKey) => void;
}

/**
 * The three-dot menu for selected messages.
 *
 * Drawn by the app rather than the OS, and anchored to the top-right corner
 * under the button that opened it, matching the rest of IRIS. Reply only makes
 * sense for a single message, so it is hidden for a multi-selection.
 */
export function MessageActionSheet({
  visible,
  count,
  onClose,
  onAction,
}: MessageActionSheetProps): React.JSX.Element {
  const rows = ROWS.filter((r) => r.key !== 'reply' || count === 1);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.heading}>{count === 1 ? '1 message' : `${count} messages`}</Text>
          {rows.map((row, index) => (
            <Pressable
              key={row.key}
              style={[styles.row, index > 0 ? styles.rowDivider : null]}
              onPress={() => onAction(row.key)}
              accessibilityRole="button"
              accessibilityLabel={row.label}
            >
              <Ionicons
                name={row.icon}
                size={19}
                color={row.destructive ? palette.danger : palette.text}
              />
              <Text style={[styles.label, row.destructive ? styles.labelDanger : null]}>
                {row.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay },
  // Anchored to the top-right, just under the header button that opens it.
  card: {
    position: 'absolute',
    top: 92,
    right: spacing.md,
    minWidth: 190,
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  heading: {
    color: palette.textMuted,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  label: { color: palette.text, fontSize: fontSize.md },
  labelDanger: { color: palette.danger },
});
