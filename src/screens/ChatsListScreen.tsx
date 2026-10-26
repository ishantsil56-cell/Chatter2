import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { hideChatForMe } from '@/services/chats';
import { scope } from '@/utils/logger';
import type { Chat } from '@/types';
import type { TabScreenProps } from '@/navigation/types';

const log = scope('ChatsList');

/** Room for the floating tab bar, so the last card is never hidden behind it. */
const TAB_BAR_CLEARANCE = 104;

export function ChatsListScreen({ navigation }: TabScreenProps<'Chats'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { chats, loading } = useChats(uid);
  const dialog = useDialog();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  /** Chats deleted on this device, hidden immediately rather than waiting for the server round-trip. */
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const searchRef = useRef<TextInput>(null);

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

  // The screen draws its own header so it can carry the wordmark, tagline and
  // shortcuts from the redesign, which the navigator's header cannot express.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
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

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.brandRow}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.brandText}>
          <Text style={styles.wordmark}>IRIS</Text>
          <Text style={styles.tagline}>PRIVATE · SECURE · TOGETHER</Text>
        </View>
        <View style={styles.spacer} />
        <Pressable
          onPress={() => searchRef.current?.focus()}
          hitSlop={10}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Search chats"
        >
          <Ionicons name="search" size={22} color={palette.text} />
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('NewChat')}
          hitSlop={10}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Start a new chat"
        >
          <Image
            source={require('../../assets/icons/newchat.png')}
            style={styles.headerIcon}
            resizeMode="contain"
            tintColor={palette.text}
          />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={palette.textMuted} />
        <TextInput
          ref={searchRef}
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
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={palette.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const compose = (
    <Pressable
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      onPress={() => navigation.navigate('NewChat')}
      accessibilityRole="button"
      accessibilityLabel="Start a new chat"
    >
      <Ionicons name="pencil" size={26} color={palette.textInverse} />
    </Pressable>
  );

  if (!loading && chats.length === 0) {
    return (
      <View style={styles.wrap}>
        {header}
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title="No chats yet"
          subtitle="Tap the pencil to start a conversation."
        />
        {compose}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {header}
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
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
      {compose}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: palette.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logo: { width: 38, height: 38 },
  brandText: { justifyContent: 'center' },
  wordmark: {
    color: palette.text,
    fontSize: fontSize.xl,
    fontFamily: 'Cinzel_600SemiBold',
    letterSpacing: 2,
  },
  tagline: {
    color: palette.textMuted,
    fontSize: 8,
    letterSpacing: 1.6,
    marginTop: 1,
  },
  spacer: { flex: 1 },
  iconButton: { padding: spacing.xs },
  headerIcon: { width: 26, height: 26 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  searchInput: { flex: 1, color: palette.text, fontSize: fontSize.md, paddingVertical: spacing.sm },
  list: { paddingTop: spacing.md, paddingBottom: TAB_BAR_CLEARANCE },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: TAB_BAR_CLEARANCE,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: palette.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
});
