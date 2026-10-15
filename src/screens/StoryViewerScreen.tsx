import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { useUsers } from '@/store/userCache';
import { palette, spacing, fontSize } from '@/theme';
import { StoryViewerHeader } from '@/components/StoryRing';
import {
  subscribeVisibleStories,
  markStoryViewed,
  toggleStoryLike,
  deleteStory,
} from '@/services/status';
import { getCrypto } from '@/services/crypto';
import { getPeerIdentityKey } from '@/services/messages';
import { openSelfEnvelope } from '@/services/historyKey';
import { downloadAndDecrypt } from '@/services/storage';
import { useDialog } from '@/components/AppDialog';
import { scope } from '@/utils/logger';
import type { Story, StoryPayload } from '@/types/extended';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('StoryViewerScreen');
const STORY_DURATION_MS = 5000;

interface DecryptedStory {
  story: Story;
  payload: StoryPayload;
  mediaUri: string | null;
}

/** Decrypt one story's payload (viewer's envelope, or owner's history copy). */
async function decryptStory(story: Story, uid: string): Promise<StoryPayload | null> {
  try {
    let json: string | null = null;
    if (story.ownerId === uid) {
      if (!story.selfEnvelope) return null;
      json = await openSelfEnvelope(uid, story.selfEnvelope);
    } else {
      const envelope = story.envelopes[uid];
      if (!envelope) return null;
      const crypto = getCrypto();
      json = await crypto.decrypt(story.ownerId, await getPeerIdentityKey(story.ownerId), envelope);
    }
    if (!json) return null;
    return JSON.parse(json) as StoryPayload;
  } catch (e) {
    log.warn('story decrypt failed', e);
    return null;
  }
}

/**
 * Full-screen story viewer: auto-advancing progress bars, tap sides to
 * navigate, like, and (for your own) delete. A view receipt is recorded the
 * moment each story is shown.
 */
export function StoryViewerScreen({ route, navigation }: AppScreenProps<'StoryViewer'>): React.JSX.Element {
  const { ownerId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const { contacts } = useSavedContacts(uid);
  const contactIds = useMemo(() => contacts.map((c) => c.uid), [contacts]);
  const profiles = useUsers(contactIds);
  const [stories, setStories] = useState<Story[]>([]);
  const [index, setIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dialog = useDialog();

  useEffect(
    () =>
      uid
        ? subscribeVisibleStories(
            uid,
            contactIds,
            (all) =>
              setStories(
                all.filter((s) => s.ownerId === ownerId).sort((a, b) => a.createdAt - b.createdAt),
              ),
            (e) => log.warn('stories failed', e),
          )
        : undefined,
    [uid, contactIds, ownerId],
  );

  const story = stories[index] ?? null;
  const isMine = !!uid && ownerId === uid;
  const [decrypted, setDecrypted] = useState<DecryptedStory | null>(null);

  // Decrypt the current story + download its media.
  useEffect(() => {
    if (!story || !uid) {
      setDecrypted(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const payload = await decryptStory(story, uid);
      if (cancelled || !payload) {
        if (!cancelled) setDecrypted(null);
        return;
      }
      let mediaUri: string | null = null;
      if (story.media && payload.mediaKey) {
        try {
          mediaUri = await downloadAndDecrypt(story.media, payload.mediaKey);
        } catch (e) {
          log.warn('story media failed', e);
        }
      }
      if (!cancelled) setDecrypted({ story, payload, mediaUri });
    })();
    return () => {
      cancelled = true;
    };
  }, [story, uid]);

  // Auto-advance + view receipt.
  useEffect(() => {
    setProgress(0);
    if (!story) return;
    if (uid) void markStoryViewed(story.id, uid).catch(() => undefined);
    const start = Date.now();
    timer.current = setInterval(() => {
      const p = (Date.now() - start) / STORY_DURATION_MS;
      if (p >= 1) {
        if (timer.current) clearInterval(timer.current);
        if (index < stories.length - 1) setIndex(index + 1);
        else navigation.goBack();
      } else {
        setProgress(p);
      }
    }, 50);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [story, index, stories.length, navigation, uid]);

  const ownerName = profiles[ownerId]?.displayName || profiles[ownerId]?.username || 'Unknown';

  const onDelete = async () => {
    if (!story || !uid) return;
    const ok = await dialog({
      title: 'Delete story?',
      message: 'This removes it for everyone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteStory(story.id, uid).catch(() => undefined);
    navigation.goBack();
  };

  const onLike = () => {
    if (!story || !uid) return;
    const next = new Set(likedIds);
    if (next.has(story.id)) next.delete(story.id);
    else next.add(story.id);
    setLikedIds(next);
    void toggleStoryLike(story.id, uid).catch(() => setLikedIds(likedIds));
  };

  if (!story) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No stories to show.</Text>
      </View>
    );
  }

  const payload = decrypted?.payload ?? null;

  return (
    <View style={styles.root}>
      {decrypted == null ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : payload?.kind === 'text' ? (
        <View style={[styles.textStory, { backgroundColor: payload.backgroundColor ?? palette.accentDark }]}>
          <Text style={styles.textStoryText}>{payload.text ?? ''}</Text>
        </View>
      ) : decrypted.mediaUri ? (
        <Image
          source={{ uri: decrypted.mediaUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="contain"
          accessibilityLabel="Story image"
        />
      ) : (
        <View style={styles.loading}>
          <Text style={styles.emptyText}>Couldn’t load this story.</Text>
        </View>
      )}

      <View style={styles.progressRow}>
        {stories.map((s, i) => (
          <View key={s.id} style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${i < index ? 100 : i === index ? progress * 100 : 0}%` },
              ]}
            />
          </View>
        ))}
      </View>

      <StoryViewerHeader
        ownerName={ownerName}
        ownerPhotoURL={profiles[ownerId]?.photoURL ?? null}
        ownerId={ownerId}
        createdAt={story.createdAt}
        onClose={() => navigation.goBack()}
        onLike={onLike}
        liked={likedIds.has(story.id)}
        onReply={() => navigation.goBack()}
      />

      <Pressable
        style={styles.tapLeft}
        onPress={() => setIndex(Math.max(0, index - 1))}
        accessibilityLabel="Previous story"
      />
      <Pressable
        style={styles.tapRight}
        onPress={() => (index < stories.length - 1 ? setIndex(index + 1) : navigation.goBack())}
        accessibilityLabel="Next story"
      />

      {isMine ? (
        <Pressable
          style={styles.deleteButton}
          onPress={() => void onDelete()}
          accessibilityRole="button"
          accessibilityLabel="Delete this story"
        >
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  empty: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: palette.textMuted, fontSize: fontSize.md },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  textStory: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  textStoryText: { color: '#fff', fontSize: fontSize.xxl, textAlign: 'center', fontWeight: '600' },
  progressRow: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    gap: 4,
  },
  progressTrack: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 2 },
  progressFill: { height: 3, backgroundColor: '#fff', borderRadius: 2 },
  tapLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%' },
  tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '70%' },
  deleteButton: {
    position: 'absolute',
    bottom: spacing.xl,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  deleteText: { color: '#fff', fontSize: fontSize.md },
});
