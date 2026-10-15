import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, radius } from '@/theme';
import { Avatar } from './Avatar';
import type { Story } from '@/types/extended';
import type { UserId } from '@/types';

export interface StoryRingProps {
  story: Story;
  ownerName: string;
  ownerPhotoURL: string | null;
  /** True when the viewer hasn't seen the latest story. */
  unseen: boolean;
  onPress: () => void;
}

/**
 * The story tray item: avatar with a gradient ring when there are unseen
 * stories (WhatsApp's signature affordance), name underneath.
 */
export function StoryRing({ story, ownerName, ownerPhotoURL, unseen, onPress }: StoryRingProps): React.JSX.Element {
  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${ownerName}'s story${unseen ? ', unseen' : ''}`}
    >
      <View style={[styles.ring, unseen ? styles.ringUnseen : styles.ringSeen]}>
        <Avatar name={ownerName} photoURL={ownerPhotoURL} seed={story.ownerId} />
      </View>
      <Text style={styles.name} numberOfLines={1}>
        {ownerName}
      </Text>
    </Pressable>
  );
}

export interface StoryViewerHeaderProps {
  ownerName: string;
  ownerPhotoURL: string | null;
  ownerId: UserId;
  createdAt: number;
  onClose: () => void;
  onLike: () => void;
  liked: boolean;
  onReply: () => void;
}

/** Header overlay for the full-screen story viewer. */
export function StoryViewerHeader({
  ownerName,
  ownerPhotoURL,
  createdAt,
  onClose,
  onLike,
  liked,
  onReply,
}: StoryViewerHeaderProps): React.JSX.Element {
  return (
    <View style={styles.header}>
      <Avatar name={ownerName} photoURL={ownerPhotoURL} seed={ownerName} />
      <View style={styles.headerText}>
        <Text style={styles.headerName} numberOfLines={1}>
          {ownerName}
        </Text>
        <Text style={styles.headerTime}>{timeAgo(createdAt)}</Text>
      </View>
      <Pressable
        style={styles.iconButton}
        onPress={onLike}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Unlike story' : 'Like story'}
      >
        <Text style={styles.icon}>{liked ? '❤️' : '🤍'}</Text>
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={onReply}
        accessibilityRole="button"
        accessibilityLabel="Reply to story"
      >
        <Text style={styles.icon}>💬</Text>
      </Pressable>
      <Pressable
        style={styles.iconButton}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close story viewer"
      >
        <Text style={styles.icon}>✕</Text>
      </Pressable>
    </View>
  );
}

function timeAgo(at: number): string {
  const mins = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

const styles = StyleSheet.create({
  item: { width: 72, alignItems: 'center', marginRight: spacing.sm },
  ring: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2.5,
  },
  ringUnseen: { borderColor: palette.accent },
  ringSeen: { borderColor: palette.border },
  name: { fontSize: fontSize.sm, color: palette.textMuted, marginTop: 4, maxWidth: 72, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
  },
  headerText: { flex: 1, marginLeft: spacing.sm },
  headerName: { fontSize: fontSize.md, color: '#fff', fontWeight: '600' },
  headerTime: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },
  iconButton: { padding: spacing.sm },
  icon: { fontSize: 20, color: '#fff' },
});
