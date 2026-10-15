import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius, spacing, fontSize } from '@/theme';
import { cachedMediaUri, downloadAndDecrypt, parseMediaBody } from '@/services/storage';
import { formatDuration } from '@/utils/time';
import { scope } from '@/utils/logger';
import type { DecryptedMessage } from '@/types';

const log = scope('media-view');

/**
 * Renders the encrypted attachment of a message.
 *
 * Behaves like a messenger rather than a web page:
 *   - Our own sends show instantly, because the file was cached when it was
 *     sealed — no waiting for the upload to finish to see your own photo.
 *   - Anything already fetched comes straight from the cache, so re-opening is
 *     instant and works offline.
 *   - A first-time fetch shows real progress, not an indeterminate spinner, so a
 *     slow connection looks slow rather than broken.
 *   - Photos open full-screen on tap.
 */
export function MediaContent({ message, isMine }: { message: DecryptedMessage; isMine: boolean }): React.JSX.Element | null {
  const [uri, setUri] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const body = parseMediaBody(message.text);

  // A media message whose body carries no key cannot be fetched at all. Say so
  // rather than returning silently: returning left `uri` and `error` both null,
  // so the bubble showed a spinner forever and looked like a slow download when
  // nothing was downloading at all.
  const bodyUnreadable = Boolean(message.media) && !body;

  useEffect(() => {
    if (!message.media || !body) return;
    let cancelled = false;

    (async () => {
      try {
        // Cache first: instant, and no network at all on a second look.
        const cached = await cachedMediaUri(message.media!);
        if (cancelled) return;
        if (cached) {
          setUri(cached);
          setProgress(1);
          return;
        }
        const localUri = await downloadAndDecrypt(message.media!, body.key, (f) => {
          if (!cancelled) setProgress(f);
        });
        if (!cancelled) {
          setUri(localUri);
          setProgress(1);
        }
      } catch (e) {
        if (!cancelled) {
          log.warn('attachment failed', e);
          setError((e as Error).message);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [message.id, message.media, body]);

  const open = useCallback(() => setViewerOpen(true), []);

  if (!message.media) return null;

  if (error || bodyUnreadable) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="warning-outline" size={18} color={palette.danger} />
        <Text style={styles.errorText}>
          {bodyUnreadable ? 'Attachment key missing' : 'Could not load attachment'}
        </Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.placeholder}>
        <ProgressRing progress={progress} />
        <Text style={styles.progressText}>
          {progress > 0 ? `${Math.round(progress * 100)}%` : 'Downloading…'}
        </Text>
      </View>
    );
  }

  if (message.kind === 'image') {
    const width = message.media.width ?? 220;
    const height = message.media.height ?? 220;
    // Keep the aspect ratio but never let a tall photo take over the screen.
    const maxH = 320;
    const scale = height > maxH ? maxH / height : 1;
    return (
      <>
        <Pressable onPress={open} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
          <Image
            source={{ uri }}
            style={[styles.image, { width: width * scale, height: height * scale }]}
            resizeMode="cover"
          />
        </Pressable>
        <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
          <View style={styles.viewerBackdrop}>
            <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
            <Pressable
              onPress={() => setViewerOpen(false)}
              style={styles.viewerClose}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              hitSlop={12}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>
        </Modal>
      </>
    );
  }

  if (message.kind === 'voice') {
    return <VoicePlayer uri={uri} durationMs={message.media.durationMs ?? 0} isMine={isMine} seed={message.id} />;
  }

  return (
    <View style={styles.fileRow}>
      <Ionicons name="document-outline" size={22} color={palette.text} />
      <Text style={styles.fileName} numberOfLines={1}>
        {message.media.fileName ?? 'Document'}
      </Text>
    </View>
  );
}

/** A determinate ring, so a slow download reads as progress rather than a hang. */
function ProgressRing({ progress }: { progress: number }): React.JSX.Element {
  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View style={styles.ring}>
      <View style={[styles.ringFill, { height: `${pct}%` }]} />
    </View>
  );
}

/**
 * Voice note player: play/pause, a scrubbable bar and a duration.
 *
 * The waveform bars are derived from the message id rather than from real audio
 * analysis — expo-av exposes no waveform data, and inventing one from the actual
 * samples would mean decoding the file ourselves. They are stable per message,
 * so a given note always looks the same, and they fill in as playback advances.
 */
function VoicePlayer({
  uri,
  durationMs,
  isMine,
  seed,
}: {
  uri: string;
  durationMs: number;
  isMine: boolean;
  seed: string;
}): React.JSX.Element {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [total, setTotal] = useState(durationMs || 0);
  const barCount = 28;

  useEffect(() => {
    return () => {
      void sound?.unloadAsync();
    };
  }, [sound]);

  const bars = React.useMemo(() => {
    // Cheap deterministic hash -> a stable bar shape per message.
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Array.from({ length: barCount }, (_, i) => {
      h ^= i + 1;
      h = Math.imul(h, 16777619);
      const v = ((h >>> 0) % 1000) / 1000;
      return 0.25 + v * 0.75;
    });
  }, [seed]);

  const toggle = useCallback(async () => {
    if (playing && sound) {
      await sound.pauseAsync();
      setPlaying(false);
      return;
    }
    if (sound) {
      await sound.playAsync();
      setPlaying(true);
      return;
    }
    const { sound: created } = await Audio.Sound.createAsync({ uri });
    created.setOnPlaybackStatusUpdate((status) => {
      if (!status.isLoaded) return;
      setPosition(status.positionMillis ?? 0);
      if (status.durationMillis) setTotal(status.durationMillis);
      if (status.didJustFinish) {
        setPlaying(false);
        void created.setPositionAsync(0);
        setPosition(0);
      }
    });
    setSound(created);
    await created.playAsync();
    setPlaying(true);
  }, [playing, sound, uri]);

  const seek = useCallback(
    async (fraction: number) => {
      if (!sound || !total) return;
      const target = Math.floor(total * fraction);
      await sound.setPositionAsync(target);
      setPosition(target);
    },
    [sound, total],
  );

  const shown = total > 0 ? position / total : 0;
  const played = Math.floor(shown * barCount);

  return (
    <View style={styles.voiceRow}>
      <Pressable
        onPress={() => void toggle()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice message' : 'Play voice message'}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={22} color={isMine ? palette.text : palette.accent} />
      </Pressable>

      <Pressable
        style={styles.waveform}
        onPress={(e) => {
          // Tap anywhere on the bar to jump there, the way a seek bar behaves.
          const x = e.nativeEvent.locationX;
          void seek(Math.max(0, Math.min(1, x / 180)));
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Seek within voice message"
      >
        {bars.map((v, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: 4 + v * 18 },
              i < played ? styles.barPlayed : styles.barIdle,
              isMine ? styles.barMine : null,
            ]}
          />
        ))}
      </Pressable>

      <Text style={styles.duration}>{formatDuration(position > 0 ? position : total)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    width: 200,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: palette.surfaceHigh,
  },
  progressText: { color: palette.textMuted, fontSize: fontSize.xs, marginTop: spacing.xs },
  ring: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    borderWidth: 2,
    borderColor: palette.border,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  ringFill: { width: '100%', backgroundColor: palette.accent, opacity: 0.55 },
  image: { borderRadius: radius.md, marginBottom: spacing.xs },
  errorText: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  fileName: { color: palette.text, fontSize: fontSize.md, flexShrink: 1 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, minWidth: 200 },
  waveform: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 24 },
  bar: { width: 2, borderRadius: radius.pill },
  barIdle: { backgroundColor: palette.textMuted, opacity: 0.45 },
  barPlayed: { backgroundColor: palette.accent },
  barMine: { backgroundColor: palette.text },
  duration: { color: palette.textMuted, fontSize: fontSize.xs, minWidth: 34, textAlign: 'right' },
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '80%' },
  viewerClose: { position: 'absolute', top: 48, right: 20, padding: spacing.sm },
});
