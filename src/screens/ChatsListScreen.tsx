import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChatBadgeStore } from '@/store/chatBadgeStore';
import { getPlaintextSync } from '@/services/messageCache';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { ChatListItem, chatTitle } from '@/components/ChatListItem';
import { EmptyState } from '@/components/EmptyState';
import { useDialog } from '@/components/AppDialog';
import { hideChatForMe, pinChat, unpinChat, archiveChat, unarchiveChat } from '@/services/chats';
import { ChatRowActionSheet } from '@/components/ChatRowActionSheet';
import { friendlyError } from '@/utils/errors';
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
  const [sheetChat, setSheetChat] = useState<Chat | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const peerIds = useMemo(
    () => Array.from(new Set(chats.flatMap((c) => c.memberIds.filter((m) => m !== uid)))),
    [chats, uid],
  );
  const users = useUsers(peerIds);
  const myUsername = useAuthStore((s) => s.profile?.username ?? '');

  // Publish the unread totals for the tab bar. Done here because this screen
  // already holds the live chats subscription — a second one just to count rows
  // would double the Firestore reads for no reason. This screen stays mounted
  // while you are on another tab, so the numbers keep updating.
  useEffect(() => {
    let unread = 0;
    let mentions = 0;
    for (const c of chats) {
      if (deleted.has(c.id)) continue;
      if (!(c.lastMessageAt > (c.lastReadAt[uid ?? ''] ?? 0) && c.lastMessageAt > 0)) continue;
      unread += 1;
      // A mention is judged from the newest message's text, which this device
      // already holds decrypted. Cheap, and it needs no extra field on the chat.
      const text = getPlaintextSync(c.lastMessageId);
      if (myUsername && text && text.toLowerCase().includes(`#${myUsername.toLowerCase()}`)) {
        mentions += 1;
      }
    }
    useChatBadgeStore.getState().set(unread, mentions);
  }, [chats, deleted, uid, myUsername]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={() => navigation.navigate('NewChat')} hitSlop={10} style={styles.headerButton}>
          <Image
            source={require('../../assets/icons/newchat.png')}
            style={styles.headerIcon}
            resizeMode="contain"
            tintColor={palette.text}
          />
        </Pressable>
      ),
    });
  }, [navigation]);

  /** Match a chat by the other person's name or @username (and the group name). */
  const visible = useMemo(() => {
    const list = chats.filter((c) => {
      if (deleted.has(c.id)) return false;
      const archived = !!c.archivedAt;
      return showArchived ? archived : !archived;
    });
    const q = query.trim().toLowerCase();
    const filtered = q
      ? list.filter((c) => {
          const title = chatTitle(c, uid ?? '', users).toLowerCase();
          const peerId = c.memberIds.find((m) => m !== uid);
          const handle = (peerId ? users[peerId]?.username ?? '' : '').toLowerCase();
          return title.includes(q) || handle.includes(q);
        })
      : list;
    // Pinned chats first, then by recency.
    return [...filtered].sort((a, b) => {
      const ap = a.pinnedAt ? 1 : 0;
      const bp = b.pinnedAt ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
  }, [chats, deleted, query, uid, users, showArchived]);

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
        {chats.some((c) => c.archivedAt && !deleted.has(c.id)) ? (
        <Pressable
          style={styles.archivedRow}
          onPress={() => setShowArchived(!showArchived)}
          accessibilityRole="button"
          accessibilityLabel={showArchived ? 'Hide archived chats' : 'Show archived chats'}
        >
          <Ionicons
            name={showArchived ? 'archive' : 'archive-outline'}
            size={20}
            color={palette.accent}
          />
          <Text style={styles.archivedText}>
            {showArchived ? 'Hide archived' : 'Archived'}
          </Text>
        </Pressable>
      ) : null}
      <ChatRowActionSheet
        visible={!!sheetChat}
        chatTitle={sheetChat ? chatTitle(sheetChat, uid ?? '', users) : ''}
        pinned={!!sheetChat?.pinnedAt}
        archived={!!sheetChat?.archivedAt}
        onClose={() => setSheetChat(null)}
        onTogglePin={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          void (c.pinnedAt ? unpinChat(c.id) : pinChat(c.id)).catch((e) => {
            log.warn('pin failed', e);
            void dialog({
              title: c.pinnedAt ? 'Couldn’t unpin chat' : 'Couldn’t pin chat',
              message: friendlyError(e),
              confirmLabel: 'OK',
            });
          });
        }}
        onToggleArchive={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          void (c.archivedAt ? unarchiveChat(c.id) : archiveChat(c.id)).catch((e) => {
            log.warn('archive failed', e);
            void dialog({
              title: c.archivedAt ? 'Couldn’t unarchive chat' : 'Couldn’t archive chat',
              message: friendlyError(e),
              confirmLabel: 'OK',
            });
          });
        }}
        onDelete={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          confirmDelete(c);
        }}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewChat')}>
          <Image
            source={require('../../assets/icons/newchat.png')}
            style={styles.fabIcon}
            resizeMode="contain"
            tintColor={palette.textInverse}
          />
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
            onLongPress={(chat) => setSheetChat(chat)}
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
      {chats.some((c) => c.archivedAt && !deleted.has(c.id)) ? (
        <Pressable
          style={styles.archivedRow}
          onPress={() => setShowArchived(!showArchived)}
          accessibilityRole="button"
          accessibilityLabel={showArchived ? 'Hide archived chats' : 'Show archived chats'}
        >
          <Ionicons
            name={showArchived ? 'archive' : 'archive-outline'}
            size={20}
            color={palette.accent}
          />
          <Text style={styles.archivedText}>
            {showArchived ? 'Hide archived' : 'Archived'}
          </Text>
        </Pressable>
      ) : null}
      <ChatRowActionSheet
        visible={!!sheetChat}
        chatTitle={sheetChat ? chatTitle(sheetChat, uid ?? '', users) : ''}
        pinned={!!sheetChat?.pinnedAt}
        archived={!!sheetChat?.archivedAt}
        onClose={() => setSheetChat(null)}
        onTogglePin={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          void (c.pinnedAt ? unpinChat(c.id) : pinChat(c.id)).catch((e) => {
            log.warn('pin failed', e);
            void dialog({
              title: c.pinnedAt ? 'Couldn’t unpin chat' : 'Couldn’t pin chat',
              message: friendlyError(e),
              confirmLabel: 'OK',
            });
          });
        }}
        onToggleArchive={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          void (c.archivedAt ? unarchiveChat(c.id) : archiveChat(c.id)).catch((e) => {
            log.warn('archive failed', e);
            void dialog({
              title: c.archivedAt ? 'Couldn’t unarchive chat' : 'Couldn’t archive chat',
              message: friendlyError(e),
              confirmLabel: 'OK',
            });
          });
        }}
        onDelete={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          confirmDelete(c);
        }}
      />
      <Pressable style={styles.fab} onPress={() => navigation.navigate('NewChat')}>
        <Image
          source={require('../../assets/icons/newchat.png')}
          style={styles.fabIcon}
          resizeMode="contain"
          tintColor={palette.textInverse}
        />
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
  list: { paddingVertical: spacing.sm, paddingBottom: 104 },
  separator: { height: 1, backgroundColor: palette.border, marginLeft: 80 },
  headerButton: { paddingHorizontal: spacing.md },
  headerIcon: { width: 30, height: 30 },
  fabIcon: { width: 36, height: 36 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: 104,
    width: 64,
    height: 64,
    borderRadius: 32,
    // Accent disc again. The old artwork was itself periwinkle, so on an accent
    // circle it vanished and the disc had to go dark. The icon is a vector that
    // takes a colour now, so it simply draws in the inverse shade and the
    // button reads as a button again.
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  title: { color: palette.text, fontWeight: fontWeight.bold, fontSize: fontSize.xl },
  archivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  archivedText: { color: palette.accent, fontSize: fontSize.md, fontWeight: '600' },
});
