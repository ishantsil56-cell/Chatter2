import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/theme';

export interface ChatRowActionSheetProps {
  visible: boolean;
  chatTitle: string;
  pinned: boolean;
  archived: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}

/** Long-press menu for a chat row: pin, archive, delete. */
export function ChatRowActionSheet({
  visible,
  chatTitle,
  pinned,
  archived,
  onClose,
  onTogglePin,
  onToggleArchive,
  onDelete,
}: ChatRowActionSheetProps): React.JSX.Element {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.heading} numberOfLines={1}>
            {chatTitle}
          </Text>
          <Pressable
            style={styles.row}
            onPress={onTogglePin}
            accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin chat' : 'Pin chat'}
          >
            <Ionicons name={pinned ? 'pin' : 'pin-outline'} size={20} color={palette.text} />
            <Text style={styles.label}>{pinned ? 'Unpin' : 'Pin'}</Text>
          </Pressable>
          <Pressable
            style={styles.row}
            onPress={onToggleArchive}
            accessibilityRole="button"
            accessibilityLabel={archived ? 'Unarchive chat' : 'Archive chat'}
          >
            <Ionicons
              name={archived ? 'archive' : 'archive-outline'}
              size={20}
              color={palette.text}
            />
            <Text style={styles.label}>{archived ? 'Unarchive' : 'Archive'}</Text>
          </Pressable>
          <Pressable
            style={styles.row}
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete chat"
          >
            <Ionicons name="trash-outline" size={20} color={palette.danger} />
            <Text style={[styles.label, styles.danger]}>Delete</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  heading: {
    color: palette.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '600',
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
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  label: { color: palette.text, fontSize: fontSize.md },
  danger: { color: palette.danger },
});
