import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ImageBackground, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { useMessages } from '@/hooks/useMessages';
import { useTyping, createTypingReporter } from '@/hooks/useTyping';
import { setLastRead } from '@/services/chats';
import { markRead, deleteMessage, decodeTextBody, previewText, sendMessage, type ReplyRef } from '@/services/messages';
import { getCrypto } from '@/services/crypto';
import { encryptAndUpload } from '@/services/storage';
import { Avatar } from '@/components/Avatar';
import { MessageBubble } from '@/components/MessageBubble';
import { useDialog } from '@/components/AppDialog';
import { MessageActionSheet, type MessageActionKey } from '@/components/MessageActionSheet';
import { ForwardPicker } from '@/components/ForwardPicker';
import { getUserFromCache } from '@/store/userCache';
import { useActiveChatStore } from '@/store/activeChatStore';
import { dismissChatNotification } from '@/services/notifications';
import { MessageInput, type PickedImage } from '@/components/MessageInput';
import { ErrorBanner } from '@/components/ErrorBanner';
import { friendlyError } from '@/utils/errors';
import { TypingIndicator } from '@/components/TypingIndicator';
import { DaySeparator } from '@/components/DaySeparator';
import { chatTitle } from '@/components/ChatListItem';
import { sameDay, formatDaySeparator } from '@/utils/time';
import { scope } from '@/utils/logger';
import type { Chat, DecryptedMessage } from '@/types';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('ChatScreen');

export function ChatScreen({ route, navigation }: AppScreenProps<'Chat'>): React.JSX.Element {
  const { chatId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const { chat, partners } = useChat(chatId, uid);
  const memberIds = useMemo(() => chat?.memberIds ?? [], [chat]);
  const {
    messages,
    loading,
    hasMore,
    loadingOlder,
    feedError,
    loadOlder,
    sendText,
    sendMedia,
    retrySend,
    discardSend,
    retryDecrypt,
  } = useMessages(chatId, uid, memberIds);
  const typingUids = useTyping(chatId, uid);
  const listRef = useRef<FlatList<DecryptedMessage>>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Message selection (long-press a bubble to start).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  const selectMode = selected.size > 0;
  // Don't yank the list to the bottom while older messages are being prepended.
  const suppressScroll = useRef(false);

  const reporter = useMemo(() => (uid ? createTypingReporter(chatId, uid) : null), [chatId, uid]);
  useEffect(() => () => reporter?.dispose(), [reporter]);

  // Header: the other person's name (or the group name) + group-info button.
  // NOTE: this sets `headerTitle`, not `title`. The navigator registers the
  // Chat screen with a `headerTitle`, and in React Navigation `headerTitle`
  // overrides `title` — which is why the header used to render blank.
  useEffect(() => {
    if (selectMode) {
      navigation.setOptions({
        headerTitle: () => (
          <Text style={styles.headerName}>
            {selected.size === 1 ? '1 selected' : `${selected.size} selected`}
          </Text>
        ),
        headerLeft: () => (
          <Pressable
            onPress={() => setSelected(new Set())}
            hitSlop={10}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Cancel selection"
          >
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        ),
        headerRight: () => (
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Message actions"
          >
            <Ionicons name="ellipsis-vertical" size={22} color={palette.text} />
          </Pressable>
        ),
      });
      return;
    }

    if (!chat || !uid) return;
    const title = chatTitle(chat, uid, partners);
    const peerId = chat.memberIds.find((m) => m !== uid) ?? null;
    const peer = peerId ? partners[peerId] : undefined;

    navigation.setOptions({
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Avatar
            name={title}
            photoURL={chat.kind === 'group' ? chat.photoURL : peer?.photoURL ?? null}
            size={34}
            seed={peerId ?? chatId}
          />
          <Text style={styles.headerName} numberOfLines={1}>
            {title}
          </Text>
        </View>
      ),
      headerLeft: undefined,
      headerRight:
        chat.kind === 'group'
          ? () => (
              <Ionicons
                name="information-circle-outline"
                size={24}
                color={palette.text}
                style={{ paddingHorizontal: 12 }}
                onPress={() => navigation.navigate('GroupInfo', { chatId })}
              />
            )
          : undefined,
    });
  }, [chat, partners, uid, navigation, chatId, selectMode, selected.size]);

  // Advance the read cursor (forward only) and send read receipts, once per message.
  const readSent = useRef<Set<string>>(new Set());
  useEffect(() => {
    readSent.current = new Set();
  }, [chatId]);
  useEffect(() => {
    if (!uid || messages.length === 0) return;
    const confirmed = messages.filter((m) => !m.pending);
    const last = confirmed[confirmed.length - 1];
    if (last) {
      void setLastRead(chatId, uid, last.createdAt, chat?.lastReadAt?.[uid] ?? 0).catch(() => undefined);
    }
    for (const m of confirmed) {
      if (m.kind === 'system' || m.senderId === uid || m.receipts?.[uid] === 'read' || readSent.current.has(m.id)) continue;
      readSent.current.add(m.id);
      void markRead(chatId, m.id, uid).catch(() => readSent.current.delete(m.id));
    }
  }, [messages, uid, chatId, chat?.lastReadAt]);

  const handleLoadOlder = useCallback(() => {
    suppressScroll.current = true;
    loadOlder();
    setTimeout(() => {
      suppressScroll.current = false;
    }, 1500);
  }, [loadOlder]);

  const onSendImage = useCallback(
    async (image: PickedImage) => {
      try {
        const { descriptor, key } = await encryptAndUpload(image.uri, chatId, image.mimeType, {
          width: image.width,
          height: image.height,
        });
        await sendMedia('image', descriptor, key);
      } catch (e) {
        log.error('image send failed', e);
        setNotice(friendlyError(e, 'Couldn’t send that photo.'));
      }
    },
    [chatId, sendMedia],
  );

  const onSendVoice = useCallback(
    async (uri: string, durationMs: number, mimeType: string) => {
      try {
        const { descriptor, key } = await encryptAndUpload(uri, chatId, mimeType, { durationMs });
        await sendMedia('voice', descriptor, key);
      } catch (e) {
        log.error('voice send failed', e);
        setNotice(friendlyError(e, 'Couldn’t send that voice message.'));
      }
    },
    [chatId, sendMedia],
  );

  const renderItem = ({ item, index }: { item: DecryptedMessage; index: number }): React.JSX.Element => {
    const prev = messages[index - 1];
    const showDay = !prev || !sameDay(prev.createdAt, item.createdAt);
    const isMine = item.senderId === uid;
    const senderName =
      chat?.kind === 'group' && !isMine ? partners[item.senderId]?.displayName ?? 'Unknown' : undefined;
    return (
      <View>
        {showDay ? <DaySeparator label={formatDaySeparator(item.createdAt)} /> : null}
        <MessageBubble
          message={item}
          isMine={isMine}
          memberIds={memberIds}
          senderName={senderName}
          onRetrySend={(id) => void retrySend(id)}
          onDiscardSend={(id) => void discardSend(id)}
          onRetryDecrypt={() => void retryDecrypt()}
          selectMode={selectMode}
          selected={selected.has(item.id)}
          onLongPress={(m) => setSelected(new Set([m.id]))}
          onPress={(m) =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(m.id)) next.delete(m.id);
              else next.add(m.id);
              return next;
            })
          }
          onReply={startReply}
          nameFor={displayNameFor}
        />
      </View>
    );
  };

  const dialog = useDialog();

  // Leaving the chat clears any selection or pending reply.
  useEffect(() => {
    setSelected(new Set());
    setReplyingTo(null);
  }, [chatId]);

  // Tell the notification layer which chat is on screen, so a message arriving
  // here doesn't buzz the phone, and clear this chat's notification on open.
  useEffect(() => {
    const onFocus = (): void => {
      useActiveChatStore.getState().setActiveChatId(chatId);
      void dismissChatNotification(chatId);
    };
    const onBlur = (): void => useActiveChatStore.getState().setActiveChatId(null);
    const unsubFocus = navigation.addListener('focus', onFocus);
    const unsubBlur = navigation.addListener('blur', onBlur);
    return () => {
      unsubFocus();
      unsubBlur();
      useActiveChatStore.getState().setActiveChatId(null);
    };
  }, [navigation, chatId]);

  /** Delete every selected message (confirmed first). */
  const deleteSelected = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await dialog({
      title: ids.length === 1 ? 'Delete message?' : `Delete ${ids.length} messages?`,
      message: 'This removes them for everyone in this chat.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setSelected(new Set());
    for (const id of ids) {
      await deleteMessage(chatId, id).catch((e) => log.warn('delete message failed', e));
    }
  }, [selected, dialog, chatId]);

  /** Begin replying to a message (from a swipe or the action sheet). */
  const startReply = useCallback((message: DecryptedMessage): void => {
    setSelected(new Set());
    setReplyingTo(message);
  }, []);

  /** The plain text of everything currently selected, in order. */
  const selectedText = useCallback(
    (ids: Set<string>): string =>
      Array.from(ids)
        .map((id) => messages.find((m) => m.id === id))
        .filter((m): m is DecryptedMessage => !!m)
        .map((m) => decodeTextBody(m.text).text)
        .filter(Boolean)
        .join('\n'),
    [messages],
  );

  /** Share the selection out through the phone's own share sheet. */
  const shareSelected = useCallback(async () => {
    const text = selectedText(selected);
    setSelected(new Set());
    if (!text) return;
    try {
      await Share.share({ message: text });
    } catch (e) {
      log.warn('share failed', e);
    }
  }, [selected, selectedText]);

  /** Copy the selection into another chat. */
  const forwardTo = useCallback(
    async (target: Chat): Promise<void> => {
      setForwardOpen(false);
      const text = selectedText(selected);
      setSelected(new Set());
      if (!text || !uid) return;
      try {
        await sendMessage(getCrypto(), {
          chatId: target.id,
          senderId: uid,
          memberIds: target.memberIds,
          kind: 'text',
          text,
        });
        setNotice(`Forwarded to ${target.name ?? 'the chat'}`);
      } catch (e) {
        setNotice(friendlyError(e, 'Couldn’t forward that message.'));
      }
    },
    [selected, selectedText, uid],
  );

  const onMenuAction = useCallback(
    (action: MessageActionKey): void => {
      setMenuOpen(false);
      if (action === 'reply') {
        const first = messages.find((m) => selected.has(m.id));
        if (first) startReply(first);
        return;
      }
      if (action === 'delete') {
        void deleteSelected();
        return;
      }
      if (action === 'share') {
        void shareSelected();
        return;
      }
      setForwardOpen(true);
    },
    [messages, selected, startReply, deleteSelected, shareSelected],
  );

  const displayNameFor = useCallback(
    (peerUid: string): string => {
      const profile = getUserFromCache(peerUid);
      return profile?.displayName || profile?.username || 'Them';
    },
    [],
  );

  return (
    <ImageBackground
      source={require('../../assets/chat-background.jpg')}
      style={styles.wrap}
      resizeMode="cover"
    >
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => {
          if (!suppressScroll.current) listRef.current?.scrollToEnd({ animated: false });
        }}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          hasMore || loadingOlder ? (
            <View style={styles.older}>
              {loadingOlder ? (
                <ActivityIndicator color={palette.accent} accessibilityLabel="Loading earlier messages" />
              ) : (
                <Pressable onPress={handleLoadOlder} accessibilityRole="button" accessibilityLabel="Load earlier messages">
                  <Text style={styles.olderText}>Load earlier messages</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} color={palette.accent} accessibilityLabel="Loading messages" />
          ) : feedError ? null : (
            <Text style={styles.empty}>No messages yet. Say hello!</Text>
          )
        }
      />

      <ErrorBanner message={feedError ?? notice} onDismiss={notice ? () => setNotice(null) : undefined} />

      {typingUids.length > 0 ? <TypingIndicator /> : null}

      <MessageInput
        replyingTo={
          replyingTo
            ? {
                name: replyingTo.senderId === uid ? 'You' : displayNameFor(replyingTo.senderId),
                preview: previewText(replyingTo.kind, replyingTo.text ?? '') || 'Message',
              }
            : null
        }
        onCancelReply={() => setReplyingTo(null)}
        onSendText={(text) => {
          const reply: ReplyRef | null = replyingTo
            ? {
                id: replyingTo.id,
                senderId: replyingTo.senderId,
                preview: previewText(replyingTo.kind, replyingTo.text ?? '') || 'Message',
              }
            : null;
          setReplyingTo(null);
          sendText(text, reply).catch((e) => setNotice(friendlyError(e, 'Couldn’t send that message.')));
        }}
        onSendImage={(image) => void onSendImage(image)}
        onSendVoice={(uri, duration, mime) => void onSendVoice(uri, duration, mime)}
        onKeystroke={() => reporter?.onKeystroke()}
        onStopTyping={() => reporter?.stop()}
      />

      <MessageActionSheet
        visible={menuOpen}
        count={selected.size}
        onClose={() => setMenuOpen(false)}
        onAction={onMenuAction}
      />
      <ForwardPicker
        visible={forwardOpen}
        count={selected.size}
        onClose={() => setForwardOpen(false)}
        onPick={(target) => void forwardTo(target)}
      />
      </KeyboardAvoidingView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  list: { paddingVertical: 8, flexGrow: 1 },
  older: { alignItems: 'center', paddingVertical: spacing.md },
  olderText: { color: palette.accent, fontSize: fontSize.sm },
  loading: { marginTop: spacing.xl },
  empty: { color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerButton: { paddingHorizontal: 12 },
  headerName: { color: palette.text, fontSize: 17, fontWeight: '600', maxWidth: 180 },
});
