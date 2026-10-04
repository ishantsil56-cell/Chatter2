import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { useMessages } from '@/hooks/useMessages';
import { useTyping, createTypingReporter } from '@/hooks/useTyping';
import { setLastRead } from '@/services/chats';
import { markRead } from '@/services/messages';
import { encryptAndUpload } from '@/services/storage';
import { Avatar } from '@/components/Avatar';
import { MessageBubble } from '@/components/MessageBubble';
import { MessageInput, type PickedImage } from '@/components/MessageInput';
import { ErrorBanner } from '@/components/ErrorBanner';
import { friendlyError } from '@/utils/errors';
import { TypingIndicator } from '@/components/TypingIndicator';
import { DaySeparator } from '@/components/DaySeparator';
import { chatTitle } from '@/components/ChatListItem';
import { sameDay, formatDaySeparator } from '@/utils/time';
import { scope } from '@/utils/logger';
import type { DecryptedMessage } from '@/types';
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
  // Don't yank the list to the bottom while older messages are being prepended.
  const suppressScroll = useRef(false);

  const reporter = useMemo(() => (uid ? createTypingReporter(chatId, uid) : null), [chatId, uid]);
  useEffect(() => () => reporter?.dispose(), [reporter]);

  // Header: the other person's name (or the group name) + group-info button.
  // NOTE: this sets `headerTitle`, not `title`. The navigator registers the
  // Chat screen with a `headerTitle`, and in React Navigation `headerTitle`
  // overrides `title` — which is why the header used to render blank.
  useEffect(() => {
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
  }, [chat, partners, uid, navigation, chatId]);

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
        />
      </View>
    );
  };

  return (
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
                <ActivityIndicator color={palette.green} accessibilityLabel="Loading earlier messages" />
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
            <ActivityIndicator style={styles.loading} color={palette.green} accessibilityLabel="Loading messages" />
          ) : feedError ? null : (
            <Text style={styles.empty}>No messages yet. Say hello!</Text>
          )
        }
      />

      <ErrorBanner message={feedError ?? notice} onDismiss={notice ? () => setNotice(null) : undefined} />

      {typingUids.length > 0 ? <TypingIndicator /> : null}

      <MessageInput
        onSendText={(text) => {
          sendText(text).catch((e) => setNotice(friendlyError(e, 'Couldn’t send that message.')));
        }}
        onSendImage={(image) => void onSendImage(image)}
        onSendVoice={(uri, duration, mime) => void onSendVoice(uri, duration, mime)}
        onKeystroke={() => reporter?.onKeystroke()}
        onStopTyping={() => reporter?.stop()}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  list: { paddingVertical: 8, flexGrow: 1 },
  older: { alignItems: 'center', paddingVertical: spacing.md },
  olderText: { color: palette.green, fontSize: fontSize.sm },
  loading: { marginTop: spacing.xl },
  empty: { color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerName: { color: palette.text, fontSize: 17, fontWeight: '600', maxWidth: 180 },
});
