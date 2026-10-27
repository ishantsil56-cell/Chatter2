import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { formatChatTimestamp } from '@/utils/time';
import { useUnreadCount } from '@/hooks/useUnreadCount';
import { Avatar } from './Avatar';
import { getPlaintextSync } from '@/services/messageCache';
import { previewText } from '@/services/messages';
import type { Chat, UserProfile, UserId } from '@/types';

export interface ChatListItemProps {
  chat: Chat;
  myUid: UserId;
  partners: Record<UserId, UserProfile>;
  onPress: (chat: Chat) => void;
  /** Long-press opens the row menu (pin / mute / star / unread / hide). */
  onLongPress?: (chat: Chat) => void;
  /** Per-user preference flags, rendered as small icons next to the title. */
  pinned?: boolean;
  muted?: boolean;
  starred?: boolean;
  /** Mark-as-unread override: forces the unread treatment even when read. */
  forceUnread?: boolean;
}

export function chatTitle(chat: Chat, myUid: UserId, partners: Record<UserId, UserProfile>): string {
  if (chat.kind === 'group') return chat.name ?? 'Group';
  const peerId = chat.memberIds.find((m) => m !== myUid);
  if (!peerId) return 'Saved messages';
  return partners[peerId]?.displayName || partners[peerId]?.username || 'Unknown';
}

/**
 * One rule for "does this row look unread", shared by the row and the
 * long-press menu: the mark-as-unread override, or a newer message than the
 * reader's cursor.
 */
export function isChatUnread(chat: Chat, myUid: UserId, forceUnread?: boolean): boolean {
  return forceUnread === true || (chat.lastMessageAt > (chat.lastReadAt[myUid] ?? 0) && chat.lastMessageAt > 0);
}

/**
 * One conversation, as a card.
 *
 * Deliberately shows only what the app can actually back up:
 *
 *   - An unread accent bar and a count badge (a dot while the count loads, or
 *     when a chat was marked unread with nothing newer), from the chat's read
 *     marker.
 *   - The real preview, taken from this device's decrypted copy when the server
 *     only holds a placeholder.
 *
 * It does NOT draw an online dot or delivery ticks. Presence and per-message
 * read state exist in this app, but neither is wired to the chat list, and a
 * green dot that is always green — or a tick that means nothing — is worse than
 * showing nothing at all.
 */
export function ChatListItem({ chat, myUid, partners, onPress, onLongPress, pinned, muted, starred, forceUnread }: ChatListItemProps): React.JSX.Element {
  const title = chatTitle(chat, myUid, partners);
  const unread = isChatUnread(chat, myUid, forceUnread);
  // The number badge. Null while the count loads (or if the query fails) —
  // the row falls back to the plain dot rather than showing a wrong number.
  const unreadCount = useUnreadCount(chat.id, myUid, chat.lastReadAt[myUid] ?? 0, chat.lastMessageAt, unread);
  // The server only holds a placeholder; show the real text from this device when we have it.
  const local = getPlaintextSync(chat.lastMessageId);
  const preview =
    chat.lastMessagePreview === 'Message' && local !== undefined
      ? previewText('text', local)
      : chat.lastMessagePreview || 'No messages yet';

  return (
    <Pressable
      style={({ pressed }) => [styles.card, unread && styles.cardUnread, pressed && styles.cardPressed]}
      onPress={() => onPress(chat)}
      onLongPress={() => onLongPress?.(chat)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${preview}.${unread ? (unreadCount != null && unreadCount > 0 ? ` ${unreadCount} unread.` : ' Unread.') : ''}`}
      accessibilityHint="Opens the chat. Long-press for more actions."
    >
      {unread ? <View style={styles.unreadBar} /> : null}

      <Avatar name={title} photoURL={chat.photoURL} seed={chat.id} size={48} />

      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={1}>
            {title}
          </Text>
          {pinned ? <Ionicons name="pin" size={14} color={palette.textMuted} /> : null}
          {muted ? <Ionicons name="notifications-off-outline" size={14} color={palette.textMuted} /> : null}
          {starred ? <Ionicons name="star" size={14} color={palette.textMuted} /> : null}
          <Text style={[styles.time, unread && styles.timeUnread]}>
            {chat.lastMessageAt ? formatChatTimestamp(chat.lastMessageAt) : ''}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
          {unread ? (
            unreadCount != null && unreadCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
              </View>
            ) : (
              // Mark-as-unread with nothing newer, or the count still loading:
              // keep the dot rather than a guessed number.
              <View style={styles.dot} />
            )
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    overflow: 'hidden',
  },
  cardUnread: { borderColor: palette.border },
  cardPressed: { backgroundColor: palette.surfaceHigh },
  // The accent edge on an unread row: reads instantly in a list, without
  // shouting the way a full accent card would.
  unreadBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: palette.accent,
  },
  body: { flex: 1, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium, flexShrink: 1 },
  titleUnread: { fontWeight: fontWeight.semibold },
  time: { color: palette.textMuted, fontSize: fontSize.xs, flexShrink: 0 },
  timeUnread: { color: palette.accent, fontWeight: fontWeight.medium },
  preview: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 3, flexShrink: 1 },
  previewUnread: { color: palette.text, opacity: 0.75 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
    flexShrink: 0,
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    paddingHorizontal: 5,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  badgeText: { color: palette.textInverse, fontSize: 11, fontWeight: fontWeight.bold },
});
