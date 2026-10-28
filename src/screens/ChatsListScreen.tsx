import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, ImageBackground, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChatBadgeStore } from '@/store/chatBadgeStore';
import { getPlaintextSync } from '@/services/messageCache';
import { useChats } from '@/hooks/useChats';
import { useUsers } from '@/store/userCache';
import { ChatListItem, chatTitle, isChatUnread } from '@/components/ChatListItem';
import { EmptyState } from '@/components/EmptyState';
import { useDialog } from '@/components/AppDialog';
import { hideChatForMe, setLastRead } from '@/services/chats';
import { useChatPrefs } from '@/hooks/useChatPrefs';
import { setPinned, setMuted, setStarred, markUnread, clearUnread } from '@/services/chatPrefs';
import { ChatRowSheet } from '@/components/ChatRowSheet';
import { friendlyError } from '@/utils/errors';
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
  const [sheetChat, setSheetChat] = useState<Chat | null>(null);
  const searchRef = useRef<TextInput>(null);
  const prefs = useChatPrefs(uid);

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
      // Mark-as-unread forces the badge even when the read cursor is current.
      if (!(prefs[c.id]?.unread === true || (c.lastMessageAt > (c.lastReadAt[uid ?? ''] ?? 0) && c.lastMessageAt > 0))) continue;
      unread += 1;
      // A mention is judged from the newest message's text, which this device
      // already holds decrypted. Cheap, and it needs no extra field on the chat.
      const text = getPlaintextSync(c.lastMessageId);
      if (myUsername && text && text.toLowerCase().includes(`#${myUsername.toLowerCase()}`)) {
        mentions += 1;
      }
    }
    useChatBadgeStore.getState().set(unread, mentions);
  }, [chats, deleted, uid, myUsername, prefs]);

  // The screen draws its own header so it can carry the wordmark, tagline and
  // shortcuts from the redesign, which the navigator's header cannot express.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  /** Match a chat by the other person's name or @username (and the group name). */
  const visible = useMemo(() => {
    const list = chats.filter((c) => !deleted.has(c.id));
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? list
      : list.filter((c) => {
          const title = chatTitle(c, uid ?? '', users).toLowerCase();
          const peerId = c.memberIds.find((m) => m !== uid);
          const handle = (peerId ? users[peerId]?.username ?? '' : '').toLowerCase();
          return title.includes(q) || handle.includes(q);
        });
    // Pinned chats first, then by recency. Pins are per-user (prefs), never
    // the shared chat doc — one person's pin must not pin for everyone.
    return [...filtered].sort((a, b) => {
      const ap = prefs[a.id]?.pinnedAt ? 1 : 0;
      const bp = prefs[b.id]?.pinnedAt ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0);
    });
  }, [chats, deleted, query, uid, users, prefs]);

  const openChat = (chat: Chat): void => navigation.navigate('Chat', { chatId: chat.id });

  /** One sheet action: run it, close the sheet, and show the failure plainly. */
  const runSheetAction = (label: string, fn: () => Promise<void>): void => {
    if (!uid || !sheetChat) return;
    setSheetChat(null);
    void fn().catch((e) => {
      log.warn(`${label} failed`, e);
      void dialog({ title: `Couldn’t ${label}`, message: friendlyError(e), confirmLabel: 'OK' });
    });
  };

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

  //
  // The header carries its own artwork, then a scrim over it.
  //
  // The app-wide background is a portrait crop, so a short wide band cut from it
  // showed only a thin vertical slice and lost the castle. This uses a landscape
  // crop of the same artwork, framed the way the mockup frames it: castle to the
  // right, dark to the left where the wordmark and tagline sit. The scrim is
  // near-transparent at the top so the picture shows, and closes down toward the
  // list so the search field and the first card sit on solid ground.
  const header = (
    <ImageBackground
      source={require('../../assets/header-art.jpg')}
      style={styles.headerArt}
      resizeMode="cover"
    >
      <LinearGradient
        colors={['rgba(8,11,20,0.06)', 'rgba(8,11,20,0.82)', 'rgba(8,11,20,0.97)']}
        locations={[0, 0.6, 1]}
        style={[styles.header, { paddingTop: insets.top + spacing.sm }]}
      >
      <View style={styles.brandRow}>
        {/*
          The eye alone, with no icon plate behind it.

          assets/icon.png is the full app icon — a rounded-square plate with a
          border and a dark backdrop — so using it here put a visible box behind
          the mark. This is the same artwork with the plate and the backdrop
          lifted off, and the glow baked into the image: a rectangular elevation
          shadow on Android would have drawn a box around it, not a halo.
        */}
        <Image source={require('../../assets/iris-eye.png')} style={styles.logo} resizeMode="contain" />
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
      </LinearGradient>
    </ImageBackground>
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
        renderItem={({ item, index }) => (
          <ChatListItem
            chat={item}
            myUid={uid ?? ''}
            partners={users}
            onPress={openChat}
            onLongPress={(chat) => setSheetChat(chat)}
            pinned={prefs[item.id]?.pinnedAt != null}
            muted={prefs[item.id]?.muted === true}
            starred={prefs[item.id]?.starred === true}
            forceUnread={prefs[item.id]?.unread === true}
            index={index}
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
      <ChatRowSheet
        visible={!!sheetChat}
        chatTitle={sheetChat ? chatTitle(sheetChat, uid ?? '', users) : ''}
        pinned={sheetChat ? prefs[sheetChat.id]?.pinnedAt != null : false}
        muted={sheetChat ? prefs[sheetChat.id]?.muted === true : false}
        starred={sheetChat ? prefs[sheetChat.id]?.starred === true : false}
        unread={sheetChat ? isChatUnread(sheetChat, uid ?? '', prefs[sheetChat.id]?.unread === true) : false}
        onClose={() => setSheetChat(null)}
        onTogglePin={() => {
          if (!uid || !sheetChat) return;
          const pinned = prefs[sheetChat.id]?.pinnedAt != null;
          runSheetAction(pinned ? 'unpin chat' : 'pin chat', () => setPinned(uid, sheetChat.id, !pinned));
        }}
        onToggleMute={() => {
          if (!uid || !sheetChat) return;
          const muted = prefs[sheetChat.id]?.muted === true;
          runSheetAction(muted ? 'unmute chat' : 'mute chat', () => setMuted(uid, sheetChat.id, !muted));
        }}
        onToggleStar={() => {
          if (!uid || !sheetChat) return;
          const starred = prefs[sheetChat.id]?.starred === true;
          runSheetAction(starred ? 'unstar chat' : 'star chat', () => setStarred(uid, sheetChat.id, !starred));
        }}
        onMarkUnread={() => {
          if (!uid || !sheetChat) return;
          runSheetAction('mark chat unread', () => markUnread(uid, sheetChat.id));
        }}
        onMarkRead={() => {
          if (!uid || !sheetChat) return;
          // Clearing the override alone is not enough: a genuinely newer
          // message would keep the row unread via the read cursor. Advance
          // the cursor to the newest message too (forward-only, like opening
          // the chat does). Read receipts still go out when the chat opens.
          const c = sheetChat;
          runSheetAction('mark chat read', async () => {
            await clearUnread(uid, c.id);
            await setLastRead(c.id, uid, c.lastMessageAt, c.lastReadAt[uid] ?? 0);
          });
        }}
        onHide={() => {
          if (!sheetChat) return;
          const c = sheetChat;
          setSheetChat(null);
          confirmDelete(c);
        }}
      />
      {compose}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  headerArt: { width: '100%' },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderSoft,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  logo: { width: 76, height: 76 },
  brandText: { justifyContent: 'center', flexShrink: 1 },
  wordmark: {
    color: palette.text,
    fontSize: 40,
    fontFamily: 'Cinzel_600SemiBold',
    letterSpacing: 4,
    lineHeight: 46,
  },
  tagline: {
    color: palette.textMuted,
    fontSize: 10,
    letterSpacing: 2.4,
    marginTop: 2,
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
