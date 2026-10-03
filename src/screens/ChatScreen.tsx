import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette } from '@/theme';
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
  const { messages, sendText, sendMedia } = useMessages(chatId, uid, memberIds);
  const typingUids = useTyping(chatId, uid);
  const listRef = useRef<FlatList<DecryptedMessage>>(null);

  const reporter = useMemo(() => (uid ? createTypingReporter(chatId, uid) : null), [chatId, uid]);

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

  // Advance read cursor + send read receipts as messages arrive.
  useEffect(() => {
    if (!uid || messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (last) void setLastRead(chatId, uid, last.createdAt);
    for (const m of messages) {
      if (m.senderId !== uid && m.receipts[uid] !== 'read') void markRead(chatId, m.id, uid);
    }
  }, [messages, uid, chatId]);

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
        <MessageBubble message={item} isMine={isMine} senderName={senderName} />
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
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        keyboardShouldPersistTaps="handled"
      />

      {typingUids.length > 0 ? <TypingIndicator /> : null}

      <MessageInput
        onSendText={(text) => void sendText(text)}
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
  list: { paddingVertical: 8 },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerName: { color: palette.text, fontSize: 17, fontWeight: '600', maxWidth: 180 },
});
