import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/theme';

export interface ChatRowSheetProps {
  visible: boolean;
  chatTitle: string;
  pinned: boolean;
  muted: boolean;
  starred: boolean;
  /** Whether the row currently reads as unread (override or newer messages). */
  unread: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onToggleStar: () => void;
  onMarkUnread: () => void;
  onMarkRead: () => void;
  onHide: () => void;
}

/** Long-press menu for a chat row: pin, mute, star, mark unread, hide.
 *  Every action here is per-user — nothing touches the shared chat doc. */
export function ChatRowSheet({
  visible,
  chatTitle,
  pinned,
  muted,
  starred,
  unread,
  onClose,
  onTogglePin,
  onToggleMute,
  onToggleStar,
  onMarkUnread,
  onMarkRead,
  onHide,
}: ChatRowSheetProps): React.JSX.Element {
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
            onPress={onToggleMute}
            accessibilityRole="button"
            accessibilityLabel={muted ? 'Unmute chat' : 'Mute chat'}
          >
            <Ionicons name={muted ? 'notifications-off' : 'notifications-off-outline'} size={20} color={palette.text} />
            <Text style={styles.label}>{muted ? 'Unmute' : 'Mute'}</Text>
          </Pressable>
          <Pressable
            style={styles.row}
            onPress={onToggleStar}
            accessibilityRole="button"
            accessibilityLabel={starred ? 'Unstar chat' : 'Star chat'}
          >
            <Ionicons name={starred ? 'star' : 'star-outline'} size={20} color={palette.text} />
            <Text style={styles.label}>{starred ? 'Unstar' : 'Star'}</Text>
          </Pressable>
          <Pressable
            style={styles.row}
            onPress={unread ? onMarkRead : onMarkUnread}
            accessibilityRole="button"
            accessibilityLabel={unread ? 'Mark as read' : 'Mark as unread'}
          >
            <Ionicons name={unread ? 'mail-open-outline' : 'mail-unread-outline'} size={20} color={palette.text} />
            <Text style={styles.label}>{unread ? 'Mark as read' : 'Mark as unread'}</Text>
          </Pressable>
          <Pressable
            style={styles.row}
            onPress={onHide}
            accessibilityRole="button"
            accessibilityLabel="Hide chat"
          >
            <Ionicons name="trash-outline" size={20} color={palette.danger} />
            <Text style={[styles.label, styles.danger]}>Hide chat</Text>
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
    color: palette.text,
    fontSize: fontSize.md,
    fontWeight: '600',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  label: { color: palette.text, fontSize: fontSize.md },
  danger: { color: palette.danger },
});
