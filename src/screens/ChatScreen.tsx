import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, ImageBackground, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { useMessages } from '@/hooks/useMessages';
import { useTyping, createTypingReporter } from '@/hooks/useTyping';
import { setLastRead } from '@/services/chats';
import { markRead, decodeTextBody, previewText, sendMessage, prepareMessage, type ReplyRef } from '@/services/messages';
import { isDeletedLocally, markDeletedLocally } from '@/services/localDeletes';
import { ReactionPicker } from '@/components/ReactionPicker';
import { EditMessageSheet } from '@/components/EditMessageSheet';
import { toggleReaction } from '@/services/reactions';
import { editMessage, deleteForEveryone, canEditMessage, canDeleteForEveryone } from '@/services/disappearing';
import { getCrypto } from '@/services/crypto';
import { encryptAndUpload } from '@/services/storage';
import { Avatar } from '@/components/Avatar';
import { MessageBubble } from '@/components/MessageBubble';
import { BlinkingLogo } from '@/components/BlinkingLogo';
import { useDialog } from '@/components/AppDialog';
import { MessageActionSheet, type MessageActionKey } from '@/components/MessageActionSheet';
import { ForwardPicker } from '@/components/ForwardPicker';
import { getUserFromCache } from '@/store/userCache';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { addContact, removeContact } from '@/services/contacts';
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
    messages: allMessages,
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
  } = useMessages(chatId, uid, memberIds, { ephemeralTtlMs: chat?.defaultEphemeralTtlMs });
  /** Bump to re-filter after a "delete for me". */
  const [localDeleteTick, setLocalDeleteTick] = useState(0);
  /**
   * "Delete for me" hides messages on this device only (see
   * services/localDeletes) — it never touches the shared document.
   */
  const messages = useMemo(
    () => allMessages.filter((m) => !isDeletedLocally(chatId ?? '', m.id)),
    [allMessages, chatId, localDeleteTick],
  );
  const typingUids = useTyping(chatId, uid);
  const listRef = useRef<FlatList<DecryptedMessage>>(null);
  /** Guards the one-time jump to the newest message when a chat opens. */
  const didInitialScroll = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  // True while a photo or voice note is being sealed and uploaded. Drives the
  // spinner on the attach button, so a slow send no longer looks like nothing.
  const [sendingMedia, setSendingMedia] = useState(false);
  // Message selection (long-press a bubble to start).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactTarget, setReactTarget] = useState<DecryptedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<DecryptedMessage | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  const selectMode = selected.size > 0;
  // Don't yank the list to the bottom while older messages are being prepended.
  const suppressScroll = useRef(false);

  const reporter = useMemo(() => (uid ? createTypingReporter(chatId, uid) : null), [chatId, uid]);
  useEffect(() => () => reporter?.dispose(), [reporter]);

  const dialog = useDialog();
  const { contacts: savedContacts } = useSavedContacts(uid);

  /** The other person in a direct chat, if this is one. */
  const peerId = useMemo(
    () => (chat && chat.kind !== 'group' ? chat.memberIds.find((m) => m !== uid) ?? null : null),
    [chat, uid],
  );
  const peerProfile = peerId ? partners[peerId] : undefined;
  const peerIsSaved = !!peerId && savedContacts.some((c) => c.uid === peerId);

  /** Save the person you're chatting with, or remove them again. */
  const toggleContact = useCallback(async (): Promise<void> => {
    if (!uid || !peerId || !peerProfile) return;
    if (peerIsSaved) {
      await removeContact(uid, peerId).catch((e) => log.warn('remove contact failed', e));
      return;
    }
    await addContact(uid, {
      uid: peerProfile.uid,
      displayName: peerProfile.displayName,
      username: peerProfile.username,
      email: peerProfile.email,
      photoURL: peerProfile.photoURL,
    }).catch((e) => log.warn('add contact failed', e));
  }, [uid, peerId, peerProfile, peerIsSaved]);

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
        <Pressable
          style={styles.headerTitle}
          // Tapping the header opens who this is: the peer's profile in a direct
          // chat, the group's info screen in a group.
          onPress={() => {
            if (chat.kind === 'group') navigation.navigate('GroupInfo', { chatId });
            else if (peerId) navigation.navigate('UserProfile', { uid: peerId });
          }}
          accessibilityRole="button"
          accessibilityLabel={chat.kind === 'group' ? 'Group info' : `${title}, open profile`}
        >
          <Avatar
            name={title}
            photoURL={chat.kind === 'group' ? chat.photoURL : peer?.photoURL ?? null}
            size={34}
            seed={peerId ?? chatId}
          />
          <Text style={styles.headerName} numberOfLines={1}>
            {title}
          </Text>
        </Pressable>
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
          : () => (
              <Pressable
                onPress={() => void toggleContact()}
                hitSlop={10}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel={peerIsSaved ? 'Remove from contacts' : 'Add to contacts'}
              >
                <Ionicons
                  name={peerIsSaved ? 'person-remove-outline' : 'person-add-outline'}
                  size={22}
                  color={peerIsSaved ? palette.textMuted : palette.text}
                />
              </Pressable>
            ),
    });
  }, [chat, partners, uid, navigation, chatId, selectMode, selected.size, peerIsSaved, toggleContact]);

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
      setSendingMedia(true);
      try {
        const { descriptor, key } = await encryptAndUpload(image.uri, chatId, image.mimeType, {
          width: image.width,
          height: image.height,
        });
        await sendMedia('image', descriptor, key);
      } catch (e) {
        log.error('image send failed', e);
        setNotice(friendlyError(e, 'Couldn’t send that photo.'));
      } finally {
        setSendingMedia(false);
      }
    },
    [chatId, sendMedia],
  );

  const onSendVoice = useCallback(
    async (uri: string, durationMs: number, mimeType: string) => {
      setSendingMedia(true);
      try {
        const { descriptor, key } = await encryptAndUpload(uri, chatId, mimeType, { durationMs });
        await sendMedia('voice', descriptor, key);
      } catch (e) {
        log.error('voice send failed', e);
        setNotice(friendlyError(e, 'Couldn’t send that voice message.'));
      } finally {
        setSendingMedia(false);
      }
    },
    [chatId, sendMedia],
  );

  // Defined here rather than further down, because `renderItem` below lists it as
  // a dependency and a `const` referenced before its own line throws.
  const displayNameFor = useCallback(
    (peerUid: string): string => {
      const profile = getUserFromCache(peerUid);
      return profile?.displayName || profile?.username || 'Them';
    },
    [],
  );

  // useCallback, not a plain function: a new identity here makes FlatList treat
  // every row as changed and re-render the lot. Combined with the memo on
  // MessageBubble, rows that did not change now cost nothing.
  const renderItem = useCallback(({ item, index }: { item: DecryptedMessage; index: number }): React.JSX.Element => {
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
          myUid={uid ?? ''}
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
          onError={(msg) => setNotice(msg)}
        />
      </View>
    );
  }, [
    messages,
    uid,
    chat,
    partners,
    memberIds,
    retrySend,
    discardSend,
    retryDecrypt,
    selectMode,
    selected,
    displayNameFor,
  ]);

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
      message: 'This removes them only from this device. Other people will still see them.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setSelected(new Set());
    const cid = chatId ?? '';
    for (const id of ids) {
      await markDeletedLocally(cid, id).catch((e) => log.warn('local delete failed', e));
    }
    setLocalDeleteTick((t) => t + 1);
  }, [selected, dialog, chatId]);

  /** Begin replying to a message (from a swipe or the action sheet). */
  const startReply = useCallback((message: DecryptedMessage): void => {
    setSelected(new Set());
    setReplyingTo(message);
  }, []);

  /** Open the reaction picker for the single selected message. */
  const startReact = useCallback(
    (message: DecryptedMessage): void => {
      setSelected(new Set());
      setReactTarget(message);
    },
    [],
  );

  /** Toggle an emoji reaction on the picker target. */
  const onPickReaction = useCallback(
    async (emoji: string): Promise<void> => {
      if (!uid || !reactTarget) return;
      try {
        await toggleReaction(chatId, reactTarget.id, uid, emoji);
      } catch (e) {
        setNotice(friendlyError(e, 'Couldn’t save that reaction.'));
      } finally {
        setReactTarget(null);
      }
    },
    [uid, chatId, reactTarget],
  );

  /** Save an edit: re-encrypt the new body, then swap the envelopes. */
  const saveEdit = useCallback(
    async (newText: string): Promise<void> => {
      if (!uid || !editTarget || !chat) throw new Error('Nothing to edit.');
      const body = decodeTextBody(editTarget.text ?? '');
      const prepared = await prepareMessage(getCrypto(), {
        chatId,
        senderId: uid,
        memberIds: chat.memberIds,
        kind: 'text',
        text: newText,
        replyTo: body.reply,
        mentions: body.mentions,
        clientId: editTarget.id,
        createdAt: editTarget.createdAt,
      });
      await editMessage(
        chatId,
        editTarget.id,
        uid,
        editTarget.createdAt,
        prepared.doc.envelopes,
        prepared.doc.selfEnvelope,
      );
      setEditTarget(null);
    },
    [uid, editTarget, chat, chatId],
  );

  /** Delete the single selected message for everyone (sender, <48h). */
  const deleteForEveryoneSelected = useCallback(async () => {
    const id = Array.from(selected)[0];
    const message = messages.find((m) => m.id === id);
    if (!id || !message || !uid) return;
    const ok = await dialog({
      title: 'Delete for everyone?',
      message: 'This removes the message for everyone in this chat.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setSelected(new Set());
    try {
      await deleteForEveryone(chatId, id, uid, message.createdAt);
    } catch (e) {
      setNotice(friendlyError(e, 'Couldn’t delete that message.'));
    }
  }, [selected, messages, uid, chatId, dialog]);

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
      const first = messages.find((m) => selected.has(m.id));
      if (action === 'reply') {
        if (first) startReply(first);
        return;
      }
      if (action === 'react') {
        if (first) startReact(first);
        return;
      }
      if (action === 'edit') {
        if (first) setEditTarget(first);
        return;
      }
      if (action === 'deleteEveryone') {
        void deleteForEveryoneSelected();
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
    [messages, selected, startReply, startReact, deleteSelected, deleteForEveryoneSelected, shareSelected],
  );

  // Single-select context for the action sheet (edit/delete windows).
  const singleSelected = selected.size === 1 ? messages.find((m) => selected.has(m.id)) ?? null : null;
  const canEdit =
    !!singleSelected &&
    !!uid &&
    canEditMessage(
      singleSelected.senderId,
      uid,
      singleSelected.createdAt,
      singleSelected.kind,
      !!singleSelected.deletedForEveryoneAt,
    );
  const canDeleteEveryone =
    !!singleSelected &&
    !!uid &&
    canDeleteForEveryone(
      singleSelected.senderId,
      uid,
      singleSelected.createdAt,
      !!singleSelected.deletedForEveryoneAt,
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
        // Jump to the newest message once, when the thread first lays out — not
        // on every content change. Messages decrypt progressively, so the old
        // version fired this dozens of times as a chat opened, dragging the list
        // to the bottom over and over, which is what made opening a chat stutter.
        onContentSizeChange={() => {
          if (didInitialScroll.current || suppressScroll.current) return;
          didInitialScroll.current = true;
          listRef.current?.scrollToEnd({ animated: false });
        }}
        // Tuning: fewer rows mounted at once, so a long thread does not build the
        // whole list before the first frame is on screen.
        initialNumToRender={14}
        maxToRenderPerBatch={10}
        updateCellsBatchingPeriod={40}
        windowSize={9}
        removeClippedSubviews
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
            <View style={styles.loading}>
              <BlinkingLogo size={72} />
            </View>
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
        // Mentions are a group feature: in a direct chat there is only one other
        // person, so a picker would be noise.
        mentionables={
          chat?.kind === 'group'
            ? (chat.memberIds
                .filter((m) => m !== uid)
                .map((m) => ({
                  uid: m,
                  username: partners[m]?.username ?? '',
                  displayName: partners[m]?.displayName ?? 'Member',
                }))
                .filter((m) => m.username.length > 0))
            : undefined
        }
        onSendText={(text, mentions) => {
          const reply: ReplyRef | null = replyingTo
            ? {
                id: replyingTo.id,
                senderId: replyingTo.senderId,
                preview: previewText(replyingTo.kind, replyingTo.text ?? '') || 'Message',
              }
            : null;
          setReplyingTo(null);
          sendText(text, reply, mentions).catch((e) =>
            setNotice(friendlyError(e, 'Couldn’t send that message.')),
          );
        }}
        onSendImage={(image) => void onSendImage(image)}
        onSendVoice={(uri, duration, mime) => void onSendVoice(uri, duration, mime)}
        onCreatePoll={() => navigation.navigate('PollCreate', { chatId })}
        sendingMedia={sendingMedia}
        onError={setNotice}
        onKeystroke={() => reporter?.onKeystroke()}
        onStopTyping={() => reporter?.stop()}
      />

      <MessageActionSheet
        visible={menuOpen}
        count={selected.size}
        onClose={() => setMenuOpen(false)}
        onAction={onMenuAction}
        canEdit={canEdit}
        canDeleteEveryone={canDeleteEveryone}
      />
      <ReactionPicker
        visible={!!reactTarget}
        onClose={() => setReactTarget(null)}
        onPick={(emoji) => void onPickReaction(emoji)}
      />
      <EditMessageSheet
        visible={!!editTarget}
        initialText={editTarget ? decodeTextBody(editTarget.text ?? '').text : ''}
        onClose={() => setEditTarget(null)}
        onSave={saveEdit}
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
  loading: { marginTop: spacing.xl, alignItems: 'center' },
  empty: { color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerButton: { paddingHorizontal: 12 },
  headerName: { color: palette.text, fontSize: 17, fontWeight: '600', maxWidth: 180 },
});
