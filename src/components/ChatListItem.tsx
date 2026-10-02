import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { formatChatTimestamp } from '@/utils/time';
import { Avatar } from './Avatar';
import type { Chat, UserProfile, UserId } from '@/types';

export interface ChatListItemProps {
  chat: Chat;
  myUid: UserId;
  partners: Record<UserId, UserProfile>;
  onPress: (chat: Chat) => void;
}

export function chatTitle(chat: Chat, myUid: UserId, partners: Record<UserId, UserProfile>): string {
  if (chat.kind === 'group') return chat.name ?? 'Group';
  const peerId = chat.memberIds.find((m) => m !== myUid);
  if (!peerId) return 'Saved messages';
  return partners[peerId]?.displayName || partners[peerId]?.phoneNumber || 'Unknown';
}

export function ChatListItem({ chat, myUid, partners, onPress }: ChatListItemProps): React.JSX.Element {
  const title = chatTitle(chat, myUid, partners);
  const unread = chat.lastMessageAt > (chat.lastReadAt[myUid] ?? 0) && chat.lastMessageAt > 0;

  return (
    <Pressable style={styles.row} onPress={() => onPress(chat)}>
      <Avatar name={title} photoURL={chat.photoURL} seed={chat.id} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.time, unread && styles.timeUnread]}>
            {chat.lastMessageAt ? formatChatTimestamp(chat.lastMessageAt) : ''}
          </Text>
        </View>
        <View style={styles.line}>
          <Text style={styles.preview} numberOfLines={1}>
            {chat.lastMessagePreview || 'No messages yet'}
          </Text>
          {unread ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>•</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.md },
  body: { flex: 1 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium, flexShrink: 1 },
  time: { color: palette.textMuted, fontSize: fontSize.xs },
  timeUnread: { color: palette.green },
  preview: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2, flexShrink: 1 },
  badge: {
    backgroundColor: palette.green,
    minWidth: 20,
    height: 20,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: palette.textInverse, fontWeight: fontWeight.bold },
});
