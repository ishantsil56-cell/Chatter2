import React, { useMemo } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { Avatar } from './Avatar';
import { chatTitle } from './ChatListItem';
import type { Chat } from '@/types';

export interface ForwardPickerProps {
  visible: boolean;
  /** Message the picker is forwarding, or null when closed. */
  count: number;
  onClose: () => void;
  onPick: (chat: Chat) => void;
}

/**
 * Choose a chat to forward the selected messages into.
 *
 * Lists the chats you are already in — forwarding to someone new is just a
 * matter of starting a chat with them first.
 */
export function ForwardPicker({ visible, count, onClose, onPick }: ForwardPickerProps): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { chats } = useChats(uid);

  const peerIds = useMemo(
    () => Array.from(new Set(chats.flatMap((c) => c.memberIds.filter((m) => m !== uid)))),
    [chats, uid],
  );
  const users = useUsers(peerIds);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>
              Forward {count === 1 ? 'message' : `${count} messages`}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
              <Ionicons name="close" size={22} color={palette.textMuted} />
            </Pressable>
          </View>

          <FlatList
            data={chats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const title = chatTitle(item, uid ?? '', users);
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => onPick(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`Forward to ${title}`}
                >
                  <Avatar name={title} photoURL={item.photoURL} seed={item.id} />
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
                </Pressable>
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <Text style={styles.empty}>You have no other chats to forward to yet.</Text>
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '70%',
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: palette.border,
    paddingBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  rowTitle: { flex: 1, color: palette.text, fontSize: fontSize.md },
  separator: { height: 1, backgroundColor: palette.border, marginLeft: 76 },
  empty: { color: palette.textMuted, fontSize: fontSize.sm, padding: spacing.lg, textAlign: 'center' },
});
