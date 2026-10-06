import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { ChatListItem, chatTitle } from '@/components/ChatListItem';
import { EmptyState } from '@/components/EmptyState';
import { useDialog } from '@/components/AppDialog';
import { hideChatForMe } from '@/services/chats';
import { scope } from '@/utils/logger';
import type { Chat } from '@/types';
import type { TabScreenProps } from '@/navigation/types';

const log = scope('ChatsList');

export function ChatsListScreen({ navigation }: TabScreenProps<'Chats'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { chats, loading } = useChats(uid);
  const dialog = useDialog();
  const [query, setQuery] = useState('');
  /** Chats deleted on this device, hidden immediately rather than waiting for the server round-trip. */
  const [deleted, setDeleted] = useState<Set<string>>(new Set());

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

  /** Match a chat by the other person's name or @username (and the group name). */
  const visible = useMemo(() => {
    const list = chats.filter((c) => !deleted.has(c.id));
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const title = chatTitle(c, uid ?? '', users).toLowerCase();
      const peerId = c.memberIds.find((m) => m !== uid);
      const handle = (peerId ? users[peerId]?.username ?? '' : '').toLowerCase();
      return title.includes(q) || handle.includes(q);
    });
  }, [chats, deleted, query, uid, users]);

  const openChat = (chat: Chat): void => navigation.navigate('Chat', { chatId: chat.id });

  const confirmDelete = (chat: Chat): void => {
    if (!uid) return;
    const title = chatTitle(chat, uid, users);
    void (async () => {
      const ok = await dialog({
        title: 'Delete chat?',
        message: `"${title}" will be removed from your list. The other person keeps their copy, and a new message will bring it back.`,
        confirmLabel: 'Delete',
        destructive: true,
      });
      if (!ok) return;
      setDeleted((prev) => new Set(prev).add(chat.id));
      void hideChatForMe(chat.id, uid).catch((e) => log.warn('could not delete chat', e));
    })();
  };

  const searchBar = (
    <View style={styles.searchWrap}>
      <Ionicons name="search" size={18} color={palette.textMuted} />
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search chats by name or @username"
        placeholderTextColor={palette.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      {query.length > 0 ? (
        <Pressable onPress={() => setQuery('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );

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
      {searchBar}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ChatListItem
            chat={item}
            myUid={uid ?? ''}
            partners={users}
            onPress={openChat}
            onLongPress={confirmDelete}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              subtitle="No chat matches that name or username."
            />
          ) : null
        }
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewChat')}>
        <Ionicons name="chatbubble" size={24} color={palette.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: palette.text, fontSize: fontSize.md, paddingVertical: spacing.sm },
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
