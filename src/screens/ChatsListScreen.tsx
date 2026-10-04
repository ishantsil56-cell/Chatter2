import React, { useEffect, useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { ChatListItem } from '@/components/ChatListItem';
import { EmptyState } from '@/components/EmptyState';
import type { Chat } from '@/types';
import type { TabScreenProps } from '@/navigation/types';

export function ChatsListScreen({ navigation }: TabScreenProps<'Chats'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { chats, loading } = useChats(uid);

  const peerIds = useMemo(
    () => Array.from(new Set(chats.flatMap((c) => c.memberIds.filter((m) => m !== uid)))),
    [chats, uid],
  );
  const users = useUsers(peerIds);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('NewChat')} hitSlop={10} style={styles.headerButton}>
          <Ionicons name="create-outline" size={22} color={palette.text} />
        </Pressable>
      ),
    });
  }, [navigation]);

  const openChat = (chat: Chat) => navigation.navigate('Chat', { chatId: chat.id });

  if (!loading && chats.length === 0) {
    return (
      <View style={styles.wrap}>
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="No chats yet"
          subtitle="Tap the pencil above to start a conversation."
        />
        <Pressable style={styles.fab} onPress={() => navigation.navigate('NewChat')}>
          <Ionicons name="chatbubble" size={24} color={palette.textInverse} />
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <FlatList
        data={chats}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChatListItem chat={item} myUid={uid ?? ''} partners={users} onPress={openChat} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewChat')}>
        <Ionicons name="chatbubble" size={24} color={palette.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  list: { paddingVertical: spacing.sm },
  separator: { height: 1, backgroundColor: palette.border, marginLeft: 80 },
  headerButton: { paddingHorizontal: spacing.md },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  title: { color: palette.text, fontWeight: fontWeight.bold, fontSize: fontSize.xl },
});
