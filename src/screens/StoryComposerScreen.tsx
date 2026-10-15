import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '@/store/authStore';
import { useSavedContacts } from '@/hooks/useSavedContacts';
import { getCrypto } from '@/services/crypto';
import { ensureSessions, getPeerIdentityKey } from '@/services/messages';
import { sealForSelf } from '@/services/historyKey';
import { encryptAndUpload } from '@/services/storage';
import { publishStory, type NewStory } from '@/services/status';
import { useDialog } from '@/components/AppDialog';
import { palette, spacing, fontSize, radius } from '@/theme';
import { scope } from '@/utils/logger';
import type { MediaDescriptor, UserId } from '@/types';
import type { StoryAudience, StoryPayload } from '@/types/extended';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('StoryComposerScreen');

const BACKGROUNDS = ['#4A5DA8', '#7B4A9E', '#2E7D6F', '#B0523C', '#333A55', '#6B8E3D'];
const FONTS = ['System', 'Serif', 'Mono'] as const;

/**
 * Story composer: text stories (background + text) or photo stories from the
 * gallery. Everything is end-to-end encrypted exactly like a message — the
 * payload is sealed per viewer, media bytes are encrypted before upload, and
 * only the descriptor is cleartext.
 */
export function StoryComposerScreen({ navigation }: AppScreenProps<'StoryComposer'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const { contacts } = useSavedContacts(uid);
  const [mode, setMode] = useState<'text' | 'photo'>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState(BACKGROUNDS[0]!);
  const [photo, setPhoto] = useState<{ uri: string; width: number; height: number } | null>(null);
  const [audience, setAudience] = useState<StoryAudience>('contacts');
  const [publishing, setPublishing] = useState(false);
  const dialog = useDialog();

  const viewers = useMemo<UserId[]>(() => {
    const ids = contacts.map((c) => c.uid);
    if (audience === 'only') return []; // TODO: audience picker UI
    return ids;
  }, [contacts, audience]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPhoto({ uri: a.uri, width: a.width ?? 0, height: a.height ?? 0 });
    setMode('photo');
  };

  const publish = async () => {
    if (!uid) return;
    if (mode === 'text' && !text.trim()) {
      await dialog({ title: 'Empty story', message: 'Write something first.', confirmLabel: 'OK' });
      return;
    }
    if (mode === 'photo' && !photo) {
      await dialog({ title: 'No photo', message: 'Pick a photo first.', confirmLabel: 'OK' });
      return;
    }
    setPublishing(true);
    try {
      const crypto = getCrypto();
      // Sessions with every viewer (same as sending a message).
      const { reachable } = await ensureSessions(crypto, uid, viewers);

      let media: MediaDescriptor | null = null;
      let mediaKey: string | undefined;
      if (mode === 'photo' && photo) {
        const up = await encryptAndUpload(photo.uri, `story-${uid}`, 'image/jpeg', {
          width: photo.width,
          height: photo.height,
        });
        media = up.descriptor;
        mediaKey = up.key;
      }

      const payload: StoryPayload = {
        kind: mode,
        text: text.trim() || undefined,
        mediaKey,
        backgroundColor: mode === 'text' ? bg : undefined,
      };
      const body = JSON.stringify(payload);

      const envelopes: NewStory['envelopes'] = {};
      for (const viewer of reachable) {
        const enc = await crypto.encrypt(viewer, body);
        envelopes[viewer] = { ciphertext: enc.ciphertext, header: enc.header };
      }
      const selfEnvelope = await sealForSelf(uid, body).catch((e) => {
        log.warn('could not seal story history copy', e);
        return null;
      });

      await publishStory(uid, {
        kind: mode,
        media,
        envelopes,
        selfEnvelope,
        audience,
      });
      navigation.goBack();
    } catch (e) {
      log.error('publish story failed', e);
      await dialog({
        title: 'Couldn’t publish',
        message: (e as Error).message || 'Something went wrong.',
        confirmLabel: 'OK',
      });
    } finally {
      setPublishing(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.tabs}>
        {(['text', 'photo'] as const).map((m) => (
          <Pressable
            key={m}
            style={[styles.tab, mode === m && styles.tabActive]}
            onPress={() => setMode(m)}
            accessibilityRole="tab"
            accessibilityLabel={`${m} story`}
          >
            <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
              {m === 'text' ? 'Text' : 'Photo'}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'text' ? (
        <>
          <View style={[styles.preview, { backgroundColor: bg }]}>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Type your story…"
              placeholderTextColor="rgba(255,255,255,0.6)"
              multiline
              maxLength={280}
              accessibilityLabel="Story text"
            />
          </View>
          <View style={styles.swatches}>
            {BACKGROUNDS.map((c) => (
              <Pressable
                key={c}
                style={[styles.swatch, { backgroundColor: c }, bg === c && styles.swatchActive]}
                onPress={() => setBg(c)}
                accessibilityRole="button"
                accessibilityLabel={`Background ${c}`}
              />
            ))}
          </View>
        </>
      ) : (
        <View style={styles.preview}>
          {photo ? (
            <Image source={{ uri: photo.uri }} style={styles.photo} resizeMode="contain" />
          ) : (
            <Pressable
              style={styles.pickButton}
              onPress={() => void pickPhoto()}
              accessibilityRole="button"
              accessibilityLabel="Pick a photo"
            >
              <Text style={styles.pickText}>Pick a photo</Text>
            </Pressable>
          )}
        </View>
      )}

      <View style={styles.audienceRow}>
        <Text style={styles.audienceLabel}>Who can see it</Text>
        {(['contacts', 'except', 'only'] as StoryAudience[]).map((a) => (
          <Pressable
            key={a}
            style={[styles.audienceChip, audience === a && styles.audienceChipActive]}
            onPress={() => setAudience(a)}
            accessibilityRole="button"
            accessibilityLabel={`Audience ${a}`}
          >
            <Text style={[styles.audienceText, audience === a && styles.audienceTextActive]}>
              {a === 'contacts' ? 'My contacts' : a === 'except' ? 'Except…' : 'Only…'}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.publish, publishing && styles.publishDisabled]}
        onPress={() => void publish()}
        disabled={publishing}
        accessibilityRole="button"
        accessibilityLabel="Publish story"
      >
        {publishing ? (
          <ActivityIndicator color={palette.textInverse} />
        ) : (
          <Text style={styles.publishText}>Publish · disappears in 24h</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background, padding: spacing.md },
  tabs: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  tab: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
  },
  tabActive: { backgroundColor: palette.accentSoft, borderColor: palette.accent },
  tabText: { color: palette.textMuted, fontSize: fontSize.md },
  tabTextActive: { color: palette.text, fontWeight: '600' },
  preview: {
    flex: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: palette.surface,
  },
  input: {
    color: '#fff',
    fontSize: fontSize.xxl,
    textAlign: 'center',
    padding: spacing.lg,
    maxWidth: '90%',
  },
  photo: { width: '100%', height: '100%' },
  pickButton: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: palette.accent,
  },
  pickText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: '600' },
  swatches: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md, justifyContent: 'center' },
  swatch: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent' },
  swatchActive: { borderColor: '#fff' },
  audienceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  audienceLabel: { color: palette.textMuted, fontSize: fontSize.sm },
  audienceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
  },
  audienceChipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  audienceText: { color: palette.textMuted, fontSize: fontSize.sm },
  audienceTextActive: { color: palette.text },
  publish: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  publishDisabled: { opacity: 0.6 },
  publishText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: '700' },
});
