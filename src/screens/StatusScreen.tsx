import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize } from '@/theme';
import { Avatar } from '@/components/Avatar';
import { EmptyState } from '@/components/EmptyState';
import { StoryRing } from '@/components/StoryRing';
import { subscribeVisibleStories } from '@/services/status';
import type { Story } from '@/types/extended';
import type { UserId, UserProfile } from '@/types';

export interface StatusScreenProps {
  myUid: UserId;
  contactIds: UserId[];
  profiles: Record<UserId, UserProfile>;
  onOpenStory: (ownerId: UserId) => void;
  onCreateStory: () => void;
}

/**
 * The Status tab: your own story row on top, then everyone else's grouped by
 * owner, unseen first — WhatsApp's exact information architecture.
 */
export function StatusScreen({ myUid, contactIds, profiles, onOpenStory, onCreateStory }: StatusScreenProps): React.JSX.Element {
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeVisibleStories(myUid, contactIds, setStories, (e) => setError(e.message)),
    [myUid, contactIds],
  );

  const myStories = useMemo(() => stories.filter((s) => s.ownerId === myUid), [stories, myUid]);
  const others = useMemo(() => {
    const byOwner = new Map<UserId, Story[]>();
    for (const s of stories) {
      if (s.ownerId === myUid) continue;
      const list = byOwner.get(s.ownerId) ?? [];
      list.push(s);
      byOwner.set(s.ownerId, list);
    }
    // Unseen owners first, then by newest story.
    return [...byOwner.entries()].sort(([a, la], [b, lb]) => {
      const aSeen = (la[0]?.views?.[myUid] ?? 0) > 0;
      const bSeen = (lb[0]?.views?.[myUid] ?? 0) > 0;
      if (aSeen !== bSeen) return aSeen ? 1 : -1;
      return (lb[0]?.createdAt ?? 0) - (la[0]?.createdAt ?? 0);
    });
  }, [stories, myUid]);

  const nameOf = (uid: UserId) =>
    profiles[uid]?.displayName || profiles[uid]?.username || 'Unknown';

  return (
    <View style={styles.root}>
      <Pressable
        style={styles.myRow}
        onPress={onCreateStory}
        accessibilityRole="button"
        accessibilityLabel={myStories.length ? 'Add to your story' : 'Create your first story'}
      >
        <View>
          <Avatar name="You" photoURL={profiles[myUid]?.photoURL ?? null} seed={myUid} />
          <View style={styles.addBadge}>
            <Text style={styles.addGlyph}>＋</Text>
          </View>
        </View>
        <View style={styles.myText}>
          <Text style={styles.myTitle}>My story</Text>
          <Text style={styles.mySubtitle}>
            {myStories.length ? `${myStories.length} update${myStories.length === 1 ? '' : 's'} · tap to add more` : 'Tap to add a story'}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.section}>Recent stories</Text>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : others.length === 0 ? (
        <EmptyState
          title="No stories yet"
          message="When your contacts post stories, they'll appear here for 24 hours."
        />
      ) : (
        <FlatList
          data={others}
          keyExtractor={([ownerId]) => ownerId}
          numColumns={4}
          renderItem={({ item: [ownerId, list] }) => (
            <StoryRing
              story={list[0]!}
              ownerName={nameOf(ownerId)}
              ownerPhotoURL={profiles[ownerId]?.photoURL ?? null}
              unseen={(list[0]?.views?.[myUid] ?? 0) === 0}
              onPress={() => onOpenStory(ownerId)}
            />
          )}
          contentContainerStyle={styles.grid}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: 'transparent', padding: spacing.md },
  myRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.lg },
  addBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: palette.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addGlyph: { color: palette.textInverse, fontSize: 14, fontWeight: '700' },
  myText: { marginLeft: spacing.md },
  myTitle: { fontSize: fontSize.md, color: palette.text, fontWeight: '600' },
  mySubtitle: { fontSize: fontSize.sm, color: palette.textMuted, marginTop: 2 },
  section: {
    fontSize: fontSize.sm,
    color: palette.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  grid: { gap: spacing.sm },
  error: { color: palette.danger, fontSize: fontSize.sm },
});
