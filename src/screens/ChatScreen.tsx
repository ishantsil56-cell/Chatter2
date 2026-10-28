import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, ImageBackground, KeyboardAvoidingView, Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { useMessages } from '@/hooks/useMessages';
import { useBlocked } from '@/hooks/useBlocked';
import { useChatPrefs } from '@/hooks/useChatPrefs';
import { clearUnread } from '@/services/chatPrefs';
import { usePresence } from '@/hooks/usePresence';
import { useTyping, createTypingReporter } from '@/hooks/useTyping';
import { setLastRead } from '@/services/chats';
import { markRead, deleteMessage, decodeTextBody, previewText, sendMessage, prepareMessage, type ReplyRef } from '@/services/messages';
import { isDeletedLocally, markDeletedLocally } from '@/services/localDeletes';
import { ReactionPicker } from '@/components/ReactionPicker';
import { EditMessageSheet } from '@/components/EditMessageSheet';
import { toggleReaction } from '@/services/reactions';
import { editMessage, canEditMessage, canDeleteForEveryone, isExpired } from '@/services/disappearing';
import { getCrypto } from '@/services/crypto';
import { encryptAndUpload, parseMediaBody } from '@/services/storage';
import { decodePollBody } from '@/services/polls';
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
import { sameDay, formatDaySeparator, formatLastSeen } from '@/utils/time';
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
    beginMediaSend,
    updateMediaProgress,
    finishMediaSend,
    failMediaSend,
    retrySend,
    discardSend,
    retryDecrypt,
  } = useMessages(chatId, uid, memberIds, { ephemeralTtlMs: chat?.defaultEphemeralTtlMs });
  const blocked = useBlocked(uid);
  const prefs = useChatPrefs(uid);
  /** Bump to re-filter after a "delete for me". */
  const [localDeleteTick, setLocalDeleteTick] = useState(0);
  /** Bump every minute so messages that just expired disappear mid-view. */
  const [expiryTick, setExpiryTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setExpiryTick((v) => v + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  // Three filters, one list: blocked senders never render (and are never
  // marked read), "delete for me" hides on this device only, and expired
  // disappearing messages vanish past their time. The server separately
  // refuses blocked senders' direct messages; this filter also covers groups.
  const messages = useMemo(
    () =>
      allMessages.filter(
        (m) => !blocked.has(m.senderId) && !isDeletedLocally(chatId ?? '', m.id) && !isExpired(m.expiresAt),
      ),
    [allMessages, blocked, chatId, localDeleteTick, expiryTick],
  );
  /** Searchable text for one message: plain text, poll question, or caption. */
  const searchableText = (m: DecryptedMessage): string => {
    if (m.kind === 'poll') return decodePollBody(m.text)?.question ?? '';
    if (m.kind === 'system') return m.systemText ?? '';
    const mediaBody = parseMediaBody(m.text);
    if (mediaBody) return mediaBody.caption ?? '';
    return decodeTextBody(m.text ?? '').text;
  };
  const searchActive = searchOpen && searchQuery.trim().length > 0;
  const searchMatches = useMemo(() => {
    if (!searchActive) return messages;
    const q = searchQuery.trim().toLowerCase();
    return messages.filter((m) => searchableText(m).toLowerCase().includes(q));
  }, [messages, searchActive, searchQuery]);
  /** What the list actually shows: matches while searching, else everything. */
  const displayed = searchActive ? searchMatches : messages;
  const typingUids = useTyping(chatId, uid);
  const listRef = useRef<FlatList<DecryptedMessage>>(null);
  // The user has scrolled up from the bottom: content growth and new messages
  // must not yank the list down while they are reading older ones.
  const userScrolledUp = useRef(false);
  // Jump-to-bottom button (WhatsApp's down-arrow): shown while scrolled up,
  // with a badge for messages that arrived while reading older ones.
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  // The button pops in + out instead of blinking: it stays mounted and its
  // opacity/scale ride this value, with touches disabled while hidden.
  const jumpAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(jumpAnim, {
      toValue: showJump ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [jumpAnim, showJump]);
  const prevDisplayedLen = useRef(0);
  const prevLastId = useRef<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // True while a photo or voice note is being sealed and uploaded. Drives the
  // spinner on the attach button, so a slow send no longer looks like nothing.
  const [sendingMedia, setSendingMedia] = useState(false);
  // Message selection (long-press a bubble to start).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactTarget, setReactTarget] = useState<DecryptedMessage | null>(null);
  const [editTarget, setEditTarget] = useState<DecryptedMessage | null>(null);
  // In-chat search: a filtered view of the loaded messages, not a jump.
  // The server cannot search encrypted content, so search covers only what
  // this device has decrypted (plus poll questions and media captions).
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);
  const [replyingTo, setReplyingTo] = useState<DecryptedMessage | null>(null);
  const selectMode = selected.size > 0;
  // Don't yank the list to the bottom while older messages are being prepended.
  const suppressScroll = useRef(false);

  // Scroll position: the pin-to-bottom and the jump button both read this.
  // Thresholds in px from the bottom: 120 counts as "away" for pinning, 300
  // for showing the button, so a small overscroll doesn't flash it.
  const handleListScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const distance = contentSize.height - layoutMeasurement.height - contentOffset.y;
    userScrolledUp.current = distance > 120;
    const show = distance > 300;
    setShowJump((prev) => (prev === show ? prev : show));
    if (distance <= 120) setNewBelow((n) => (n === 0 ? n : 0));
  }, []);

  const jumpToBottom = useCallback(() => {
    userScrolledUp.current = false;
    setNewBelow(0);
    setShowJump(false);
    listRef.current?.scrollToEnd({ animated: true });
  }, []);

  // Badge count: new messages that arrived below the viewport while scrolled
  // up. Loading older messages grows the list from the top (last id unchanged),
  // and search filtering is not new mail — neither counts.
  useEffect(() => {
    const lastId = displayed.length > 0 ? displayed[displayed.length - 1]!.id : null;
    const grew = displayed.length > prevDisplayedLen.current;
    if (grew && lastId !== prevLastId.current && userScrolledUp.current && !searchActive) {
      setNewBelow((n) => n + (displayed.length - prevDisplayedLen.current));
    }
    prevDisplayedLen.current = displayed.length;
    prevLastId.current = lastId;
  }, [displayed, searchActive]);

  useEffect(() => {
    prevDisplayedLen.current = 0;
    prevLastId.current = null;
    userScrolledUp.current = false;
    setNewBelow(0);
    setShowJump(false);
  }, [chatId]);

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
  const peerPresence = usePresence(peerId);
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
        headerStyle: { backgroundColor: '#0A0E2B' },
        headerTintColor: palette.accent,
        headerShadowVisible: false,
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
    // Presence for a direct chat: "Online" while the heartbeat is fresh, else
    // the last-seen line. Groups show no status, like WhatsApp.
    const isDirect = chat.kind !== 'group' && !!peerId;
    const statusText =
      !isDirect || !peerPresence
        ? null
        : peerPresence.online
          ? 'Online'
          : peerPresence.lastSeen
            ? formatLastSeen(peerPresence.lastSeen)
            : null;
    const showDot = !!isDirect && !!peerPresence?.online;

    navigation.setOptions({
      headerStyle: { backgroundColor: '#0A0E2B' },
      headerTintColor: palette.accent,
      headerShadowVisible: false,
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
          <View style={styles.headerAvatarWrap}>
            <Avatar
              name={title}
              photoURL={chat.kind === 'group' ? chat.photoURL : peer?.photoURL ?? null}
              size={40}
              seed={peerId ?? chatId}
            />
            {showDot ? <View style={styles.onlineDot} /> : null}
          </View>
          <View>
            <Text style={styles.headerName} numberOfLines={1}>
              {title}
            </Text>
            {statusText ? (
              <Text
                style={[styles.headerStatus, peerPresence?.online ? styles.headerStatusOnline : null]}
                numberOfLines={1}
              >
                {statusText}
              </Text>
            ) : null}
          </View>
        </Pressable>
      ),
      headerLeft: undefined,
      headerRight:
        chat.kind === 'group'
          ? () => (
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  hitSlop={10}
                  style={styles.headerButton}
                  accessibilityRole="button"
                  accessibilityLabel="Search in this chat"
                >
                  <Ionicons name="search-outline" size={22} color={palette.text} />
                </Pressable>
                <Ionicons
                  name="information-circle-outline"
                  size={24}
                  color={palette.text}
                  style={{ paddingHorizontal: 12 }}
                  onPress={() => navigation.navigate('GroupInfo', { chatId })}
                />
              </View>
            )
          : () => (
              <View style={styles.headerActions}>
                <Pressable
                  onPress={() => setSearchOpen(true)}
                  hitSlop={10}
                  style={styles.headerButton}
                  accessibilityRole="button"
                  accessibilityLabel="Search in this chat"
                >
                  <Ionicons name="search-outline" size={22} color={palette.text} />
                </Pressable>
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
              </View>
            ),
    });
  }, [chat, partners, uid, navigation, chatId, selectMode, selected.size, peerIsSaved, toggleContact, peerPresence]);

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

  //
  // The picture goes on screen FIRST, then uploads behind it.
  //
  // This is the whole difference from how it felt before: the bubble used to
  // appear only once the upload had finished, so sending a photo meant staring
  // at nothing and then having it arrive all at once. Now the bubble is placed
  // immediately from the local file, and the same id is reused for the real
  // message so it does not blink when the send completes.
  const onSendImage = useCallback(
    async (image: PickedImage) => {
      const id = beginMediaSend('image', image.uri);
      if (!id) return;
      setSendingMedia(true);
      try {
        const { descriptor, key } = await encryptAndUpload(
          image.uri,
          chatId,
          image.mimeType,
          { width: image.width, height: image.height },
          (fraction) => updateMediaProgress(id, fraction),
        );
        await finishMediaSend(id, descriptor, key);
      } catch (e) {
        log.error('image send failed', e);
        const reason = friendlyError(e, 'Couldn’t send that photo.');
        failMediaSend(id, reason);
        setNotice(reason);
      } finally {
        setSendingMedia(false);
      }
    },
    [chatId, beginMediaSend, updateMediaProgress, finishMediaSend, failMediaSend],
  );

  const onSendVoice = useCallback(
    async (uri: string, durationMs: number, mimeType: string) => {
      const id = beginMediaSend('voice', uri);
      if (!id) return;
      setSendingMedia(true);
      try {
        const { descriptor, key } = await encryptAndUpload(
          uri,
          chatId,
          mimeType,
          { durationMs },
          (fraction) => updateMediaProgress(id, fraction),
        );
        await finishMediaSend(id, descriptor, key);
      } catch (e) {
        log.error('voice send failed', e);
        const reason = friendlyError(e, 'Couldn’t send that voice message.');
        failMediaSend(id, reason);
        setNotice(reason);
      } finally {
        setSendingMedia(false);
      }
    },
    [chatId, beginMediaSend, updateMediaProgress, finishMediaSend, failMediaSend],
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
    const prev = displayed[index - 1];
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
    displayed,
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
      // Opening clears a mark-as-unread override (only when one is set, so
      // opening a chat does not spam a prefs write on every visit).
      if (uid && prefs[chatId]?.unread === true) {
        void clearUnread(uid, chatId).catch(() => undefined);
      }
    };
    const onBlur = (): void => useActiveChatStore.getState().setActiveChatId(null);
    const unsubFocus = navigation.addListener('focus', onFocus);
    const unsubBlur = navigation.addListener('blur', onBlur);
    return () => {
      unsubFocus();
      unsubBlur();
      useActiveChatStore.getState().setActiveChatId(null);
    };
  }, [navigation, chatId, uid, prefs]);

  /** Delete every selected message (confirmed first). Delete here means
   *  "for me": it hides them on this device only, never touching the
   *  shared document. "Delete for everyone" is a separate single-message
   *  action below, gated to the 48h window. */
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
      // The tray's "+" is a dead end: there is no full emoji keyboard in the
      // app, so it just closes the tray instead of saving "+" as a reaction.
      if (emoji === '+') {
        setReactTarget(null);
        return;
      }
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
      await deleteMessage(chatId, id);
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
      !!singleSelected.deletedForEveryone,
    );
  const canDeleteEveryone =
    !!singleSelected &&
    !!uid &&
    canDeleteForEveryone(
      singleSelected.senderId,
      uid,
      singleSelected.createdAt,
      !!singleSelected.deletedForEveryone,
    );

  return (
    <ImageBackground
      source={require('../../assets/chat-background.jpg')}
      style={styles.wrap}
      resizeMode="cover"
    >
      {/* Dim the artwork so the chat reads the way the reference screenshot
          does: the eye and castle stay visible, but faint, behind the bubbles. */}
      <View style={styles.dim} />
      <KeyboardAvoidingView
        style={styles.wrap}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      {searchOpen ? (
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={palette.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search in this chat"
            placeholderTextColor={palette.textMuted}
            autoFocus
            returnKeyType="search"
            accessibilityLabel="Search in this chat"
          />
          {searchActive ? (
            <Text style={styles.searchCount}>
              {searchMatches.length === 0 ? 'No matches' : `${searchMatches.length} match${searchMatches.length === 1 ? '' : 'es'}`}
            </Text>
          ) : null}
          <Pressable
            onPress={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close search"
          >
            <Ionicons name="close" size={20} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.listWrap}>
      <FlatList
        ref={listRef}
        data={displayed}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        // Pin to the newest message while the thread first loads (messages
        // decrypt progressively, so the content grows in steps) and whenever
        // a new message lands — unless the user has scrolled up to read older
        // ones, or older messages are being prepended. The old once-only jump
        // fired on the first partial layout and never again, which is why a
        // chat often opened mid-thread instead of at the last message.
        onContentSizeChange={() => {
          if (suppressScroll.current || userScrolledUp.current) return;
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
      <Animated.View
        style={[
          styles.jumpButton,
          {
            opacity: jumpAnim,
            transform: [{ scale: jumpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          },
        ]}
        pointerEvents={showJump ? 'auto' : 'none'}
      >
        <Pressable
          style={styles.jumpInner}
          onPress={jumpToBottom}
          accessibilityRole="button"
          accessibilityLabel="Scroll to bottom"
        >
          <Ionicons name="arrow-down" size={24} color={palette.text} />
          {newBelow > 0 ? (
            <View style={styles.jumpBadge}>
              <Text style={styles.jumpBadgeText}>{newBelow > 99 ? '99+' : String(newBelow)}</Text>
            </View>
          ) : null}
        </Pressable>
      </Animated.View>
      </View>

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
        key={editTarget?.id ?? 'none'}
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
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(4,6,18,0.55)' },
  list: { paddingVertical: 8, flexGrow: 1 },
  older: { alignItems: 'center', paddingVertical: spacing.md },
  olderText: { color: palette.accent, fontSize: fontSize.sm },
  loading: { marginTop: spacing.xl, alignItems: 'center' },
  empty: { color: palette.textMuted, textAlign: 'center', marginTop: spacing.xl },
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerAvatarWrap: { position: 'relative' },
  onlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: palette.online,
    borderWidth: 2,
    borderColor: '#0A0E2B',
  },
  headerStatus: { color: palette.textMuted, fontSize: 13 },
  headerStatusOnline: { color: palette.online },
  listWrap: { flex: 1 },
  jumpButton: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  jumpInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  jumpBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBadgeText: { color: palette.text, fontSize: 11, fontWeight: '700' },
  headerButton: { paddingHorizontal: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  headerName: { color: palette.text, fontSize: 17, fontWeight: '600', maxWidth: 180 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.borderSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  searchInput: { flex: 1, color: palette.text, fontSize: fontSize.md, paddingVertical: 4 },
  searchCount: { color: palette.textMuted, fontSize: fontSize.sm, flexShrink: 0 },
});
