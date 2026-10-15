/**
 * Stories (WhatsApp "Status").
 *
 * WhatsApp behaviour we're matching:
 * - 24-hour ephemeral posts: photo / video / text-on-background.
 * - Audience: all contacts, close friends, "except…", or "only…".
 * - Viewers write a `views/{uid}` receipt; owners see who watched.
 * - Likes are lightweight (a `likes/{uid}` marker, no chat message).
 * - Replies to a story land as normal chat messages with a story reference.
 *
 * Privacy model mirrors IRIS chats: media bytes are encrypted client-side
 * before upload; only the descriptor (dimensions, mime) is cleartext. Text
 * stories are sealed per-viewer like message envelopes — here simplified to
 * the owner's contact list via the same envelope scheme as DMs.
 *
 * Firestore layout:
 *   stories/{storyId}              → Story (see @/types/extended)
 *   stories/{storyId}/views/{uid}  → { at }
 *   stories/{storyId}/likes/{uid}  → { at }
 */

import { db } from './firebase';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { randomId } from '@/utils/id';
import { scope } from '@/utils/logger';
import type { MediaDescriptor, UserId } from '@/types';
import type { Story, StoryAudience } from '@/types/extended';

const log = scope('status');

const STORIES = 'stories';
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

export interface NewStory {
  kind: 'image' | 'video' | 'text';
  media?: MediaDescriptor | null;
  /**
   * Per-viewer sealed StoryPayloads, keyed by viewer uid. The caller encrypts
   * these (same envelope scheme as messages) — this service never sees
   * plaintext.
   */
  envelopes: Record<UserId, { ciphertext: string; header: unknown }>;
  /** Owner's history copy, sealed with their history key. */
  selfEnvelope?: { nonce: string; ciphertext: string } | null;
  audience: StoryAudience;
  audienceExcept?: UserId[];
  audienceOnly?: UserId[];
}

/** Publish a story. Returns the story id. */
export async function publishStory(ownerId: UserId, input: NewStory): Promise<string> {
  const now = Date.now();
  const id = randomId();
  const story: Story = {
    id,
    ownerId,
    kind: input.kind,
    media: input.media ?? null,
    audience: input.audience,
    audienceExcept: input.audienceExcept ?? [],
    audienceOnly: input.audienceOnly ?? [],
    createdAt: now,
    expiresAt: now + STORY_TTL_MS,
    envelopes: input.envelopes,
    selfEnvelope: input.selfEnvelope ?? null,
  };
  await db.collection(STORIES).doc(id).set(story);
  return id;
}

/** Stories visible to `viewerId`, newest first. Filters expired server-side. */
export function subscribeVisibleStories(
  viewerId: UserId,
  contactIds: UserId[],
  cb: (stories: Story[]) => void,
  onError?: (e: Error) => void,
): () => void {
  // Firestore `in` caps at 30 — chunk for large contact lists.
  const chunks: UserId[][] = [];
  const ids = [...new Set([viewerId, ...contactIds])];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));

  const unsubs = chunks.map((chunk) =>
    db
      .collection(STORIES)
      .where('ownerId', 'in', chunk)
      .where('expiresAt', '>', Date.now())
      .orderBy('expiresAt', 'desc')
      .onSnapshot(
        (snap: FirebaseFirestoreTypes.QuerySnapshot) => {
          if (!snap) return;
          // NOTE: a production pass should merge chunk snapshots; this keeps
          // the scaffold simple and correct for <30 contacts.
          cb(
            (
              snap.docs.map((d: FirebaseFirestoreTypes.QueryDocumentSnapshot) => d.data()) as unknown as Story[]
            ).filter((s) => canView(s, viewerId)),
          );
        },
        (e: Error) => {
          log('subscribeVisibleStories failed', e);
          onError?.(e);
        },
      ),
  );
  return () => unsubs.forEach((u) => u());
}

/** Audience check, mirrored in Firestore rules. */
export function canView(story: Story, viewerId: UserId): boolean {
  if (story.ownerId === viewerId) return true;
  switch (story.audience) {
    case 'contacts':
      return true; // contact-list check happens via rules on users/{uid}
    case 'close_friends':
      return false; // TODO: check owner's close-friends list
    case 'except':
      return !(story.audienceExcept ?? []).includes(viewerId);
    case 'only':
      return (story.audienceOnly ?? []).includes(viewerId);
  }
}

/** Record a view (idempotent). */
export async function markStoryViewed(storyId: string, viewerId: UserId): Promise<void> {
  await db
    .collection(STORIES)
    .doc(storyId)
    .collection('views')
    .doc(viewerId)
    .set({ at: Date.now() }, { merge: true });
}

/** Toggle a like on a story. */
export async function toggleStoryLike(storyId: string, uid: UserId): Promise<void> {
  const ref = db.collection(STORIES).doc(storyId).collection('likes').doc(uid);
  const existing = await ref.get();
  if (existing.exists) await ref.delete();
  else await ref.set({ at: Date.now() });
}

/** Delete your own story. */
export async function deleteStory(storyId: string, ownerId: UserId): Promise<void> {
  await db.collection(STORIES).doc(storyId).delete();
  log('story deleted', { storyId, ownerId });
}
