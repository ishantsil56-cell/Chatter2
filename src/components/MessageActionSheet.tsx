import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius, useTheme } from '@/theme';
import { AnimatedPressable } from './AnimatedPressable';

const AnimatedCard = Animated.createAnimatedComponent(Pressable);

export type MessageActionKey =
  | 'reply'
  | 'react'
  | 'edit'
  | 'delete'
  | 'deleteEveryone'
  | 'share'
  | 'forward';

interface ActionRow {
  key: MessageActionKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  destructive?: boolean;
}

const ROWS: ActionRow[] = [
  { key: 'react', label: 'React', icon: 'happy-outline' },
  { key: 'reply', label: 'Reply', icon: 'arrow-undo-outline' },
  { key: 'edit', label: 'Edit', icon: 'pencil-outline' },
  { key: 'forward', label: 'Forward', icon: 'arrow-redo-outline' },
  { key: 'share', label: 'Share', icon: 'share-outline' },
  { key: 'deleteEveryone', label: 'Delete for everyone', icon: 'trash-outline', destructive: true },
  { key: 'delete', label: 'Delete for me', icon: 'trash-outline', destructive: true },
];

export interface MessageActionSheetProps {
  visible: boolean;
  /** How many messages are selected — drives the heading and the wording. */
  count: number;
  onClose: () => void;
  onAction: (action: MessageActionKey) => void;
  /** Single-select context: is the message ours, and can it still be edited / deleted for everyone? */
  canEdit?: boolean;
  canDeleteEveryone?: boolean;
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
  canEdit = false,
  canDeleteEveryone = false,
}: MessageActionSheetProps): React.JSX.Element {
  const rows = ROWS.filter((r) => {
    if (count !== 1 && (r.key === 'reply' || r.key === 'react' || r.key === 'edit' || r.key === 'deleteEveryone'))
      return false;
    if (r.key === 'edit' && !canEdit) return false;
    if (r.key === 'deleteEveryone' && !canDeleteEveryone) return false;
    return true;
  });

  // The card drops + fades in on every open, while the backdrop keeps the
  // Modal's own fade. Driven by `visible`, not by mount: Modal children stay
  // mounted while hidden, so a mount effect would play once, invisibly, and
  // never again.
  const theme = useTheme();
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visible) {
      enter.setValue(0);
      return;
    }
    if (theme.reduceMotion) {
      enter.setValue(1);
      return;
    }
    const animation = Animated.timing(enter, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [enter, visible, theme.reduceMotion]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu">
        <AnimatedCard
          style={[
            styles.card,
            { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] },
          ]}
          onPress={() => undefined}
        >
          <Text style={styles.heading}>{count === 1 ? '1 message' : `${count} messages`}</Text>
          {rows.map((row, index) => (
            <AnimatedPressable
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
            </AnimatedPressable>
          ))}
        </AnimatedCard>
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
