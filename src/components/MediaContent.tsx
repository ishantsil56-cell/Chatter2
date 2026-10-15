import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { PanGestureHandler, PinchGestureHandler, State } from 'react-native-gesture-handler';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius, spacing, fontSize } from '@/theme';
import { cachedMediaUri, downloadAndDecrypt, parseMediaBody } from '@/services/storage';
import { formatDuration } from '@/utils/time';
import { scope } from '@/utils/logger';
import type { DecryptedMessage } from '@/types';

const log = scope('media-view');

const MIN_SCALE = 1;
const MAX_SCALE = 5;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Renders the encrypted attachment of a message.
 *
 * Behaves like a messenger rather than a web page:
 *   - Our own sends show instantly from the local file, with the upload running
 *     behind them, so the picture is in the chat before the bytes have left.
 *   - Anything already fetched comes from a local cache, so re-opening is
 *     instant and works offline.
 *   - A first-time fetch shows real progress, not an indeterminate spinner.
 *   - Photos open full-screen and can be zoomed.
 */
export function MediaContent({ message, isMine }: { message: DecryptedMessage; isMine: boolean }): React.JSX.Element | null {
  const [uri, setUri] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const body = parseMediaBody(message.text);

  // Still on its way up: render the local file, and say so.
  const staged = Boolean(message.localUri) && !message.media;
  // A media message whose body carries no key cannot be fetched at all. Say so
  // rather than returning silently, which left the bubble spinning forever.
  const bodyUnreadable = Boolean(message.media) && !body;

  useEffect(() => {
    if (staged || !message.media || !body) return;
    let cancelled = false;

    (async () => {
      try {
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
  }, [message.id, message.media, body, staged]);

  const open = useCallback(() => setViewerOpen(true), []);

  // Our own send, still uploading: the real picture, with progress over it.
  if (staged) {
    const local = message.localUri!;
    if (message.kind === 'voice') {
      return (
        <View style={styles.voiceRow}>
          <Ionicons name="mic" size={20} color={isMine ? palette.text : palette.accent} />
          <View style={styles.waveform}>
            <View style={[styles.bar, styles.barIdle, { width: `${Math.max(6, message.uploadProgress ? message.uploadProgress * 100 : 6)}%` }]} />
          </View>
          <Text style={styles.duration}>
            {message.uploadError ? 'Failed' : `${Math.round((message.uploadProgress ?? 0) * 100)}%`}
          </Text>
        </View>
      );
    }
    const width = 220;
    const height = 220;
    return (
      <View>
        <Image source={{ uri: local }} style={[styles.image, { width, height }]} resizeMode="cover" />
        <View style={styles.uploadOverlay} pointerEvents="none">
          {message.uploadError ? (
            <Ionicons name="alert-circle" size={22} color={palette.danger} />
          ) : (
            <>
              <ProgressRing progress={message.uploadProgress ?? 0} />
              <Text style={styles.overlayText}>{Math.round((message.uploadProgress ?? 0) * 100)}%</Text>
            </>
          )}
        </View>
      </View>
    );
  }

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
        <PhotoViewer uri={uri} visible={viewerOpen} onClose={() => setViewerOpen(false)} />
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

/**
 * Full-screen photo with zoom.
 *
 * Pinch works where gesture-handler is wired up, but zoom is also available from
 * the +/− controls and by double-tapping, so the feature does not depend on a
 * gesture root being present — a pinch that silently does nothing is worse than
 * no pinch at all, and this way there is always a way in.
 *
 * Transform values are driven by React Native's Animated, not Reanimated, which
 * is not part of this build.
 */
function PhotoViewer({ uri, visible, onClose }: { uri: string; visible: boolean; onClose: () => void }): React.JSX.Element {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  // Committed values, so a new gesture builds on the last one instead of
  // snapping back the moment you lift your fingers.
  const committedScale = useRef(1);
  const committedX = useRef(0);
  const committedY = useRef(0);
  const lastTap = useRef(0);
  // Mirrors "is this zoomed in?" in React state, because the pan handler needs
  // to be enabled by a re-render when zoom changes — a ref would not trigger one.
  const [zoomed, setZoomed] = useState(false);

  const reset = useCallback(() => {
    committedScale.current = 1;
    committedX.current = 0;
    committedY.current = 0;
    scale.setValue(1);
    translateX.setValue(0);
    translateY.setValue(0);
    setZoomed(false);
  }, [scale, translateX, translateY]);

  const zoomTo = useCallback(
    (next: number) => {
      const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
      committedScale.current = clamped;
      if (clamped <= 1) {
        committedX.current = 0;
        committedY.current = 0;
        translateX.setValue(0);
        translateY.setValue(0);
      }
      setZoomed(clamped > 1);
      Animated.timing(scale, { toValue: clamped, duration: 160, useNativeDriver: true }).start();
    },
    [scale, translateX, translateY],
  );

  const onPinchEvent = Animated.event([{ nativeEvent: { scale } }], { useNativeDriver: true });
  const onPinchStateChange = useCallback(
    (event: { nativeEvent: { oldState: number; scale: number } }) => {
      if (event.nativeEvent.oldState === State.ACTIVE) {
        const next = clamp(committedScale.current * event.nativeEvent.scale, MIN_SCALE, MAX_SCALE);
        committedScale.current = next;
        scale.setValue(next);
        setZoomed(next > 1);
      }
    },
    [scale],
  );

  // Pan is applied as committed + live translation. Setting it to the raw
  // translation (the obvious Animated.event form) makes the second drag start
  // from zero and snap the picture back, which looks broken.
  const onPanEvent = useCallback(
    (event: { nativeEvent: { translationX: number; translationY: number } }) => {
      translateX.setValue(committedX.current + event.nativeEvent.translationX);
      translateY.setValue(committedY.current + event.nativeEvent.translationY);
    },
    [translateX, translateY],
  );
  const onPanStateChange = useCallback(
    (event: { nativeEvent: { oldState: number; translationX: number; translationY: number } }) => {
      if (event.nativeEvent.oldState === State.ACTIVE) {
        committedX.current += event.nativeEvent.translationX;
        committedY.current += event.nativeEvent.translationY;
      }
    },
    [],
  );

  const onDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      zoomTo(committedScale.current > 1.2 ? 1 : 2.5);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  }, [zoomTo]);

  const close = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.viewerBackdrop}>
        <PanGestureHandler
          enabled={zoomed}
          onGestureEvent={onPanEvent}
          onHandlerStateChange={onPanStateChange}
        >
          <PinchGestureHandler onGestureEvent={onPinchEvent} onHandlerStateChange={onPinchStateChange}>
            <Animated.View style={styles.viewerStage}>
              <Pressable onPress={onDoubleTap} style={styles.viewerStage}>
                <Animated.Image
                  source={{ uri }}
                  resizeMode="contain"
                  style={[
                    styles.viewerImage,
                    { transform: [{ translateX }, { translateY }, { scale }] },
                  ]}
                />
              </Pressable>
            </Animated.View>
          </PinchGestureHandler>
        </PanGestureHandler>

        <Pressable
          onPress={close}
          style={styles.viewerClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          hitSlop={12}
        >
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>

        <View style={styles.zoomBar}>
          <Pressable
            onPress={() => zoomTo(committedScale.current - 0.5)}
            style={styles.zoomButton}
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            hitSlop={8}
          >
            <Ionicons name="remove" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={reset}
            style={styles.zoomButton}
            accessibilityRole="button"
            accessibilityLabel="Reset zoom"
            hitSlop={8}
          >
            <Ionicons name="contract" size={18} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => zoomTo(committedScale.current + 0.5)}
            style={styles.zoomButton}
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            hitSlop={8}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** A determinate ring, so a slow transfer reads as progress rather than a hang. */
function ProgressRing({ progress }: { progress: number }): React.JSX.Element {
  const pct = Math.round(clamp(progress, 0, 1) * 100);
  return (
    <View style={styles.ring}>
      <View style={[styles.ringFill, { height: `${pct}%` }]} />
    </View>
  );
}

/**
 * The note currently playing, if any.
 *
 * A module-level slot rather than context: voice notes are siblings in a list,
 * and starting one has to silence the others. Without this, tapping two notes
 * plays them over each other, which is the most jarring thing a voice message
 * can do.
 */
let activeVoicePause: (() => Promise<void>) | null = null;

/**
 * Voice note player: play/pause, a scrubbable bar and a duration.
 *
 * The waveform bars are derived from the message id rather than from real audio
 * analysis — expo-av exposes no waveform data, and decoding the file ourselves
 * to get one would be a lot of work for a decoration. They are stable per
 * message and fill in as playback advances.
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

  // A ref alongside the state, because the pause callback is registered globally
  // and would otherwise close over a stale sound object.
  const soundRef = useRef<Audio.Sound | null>(null);
  soundRef.current = sound;

  /** Pause this note. Called by whichever note starts playing next. */
  const pauseSelf = useCallback(async () => {
    try {
      await soundRef.current?.pauseAsync();
    } catch {
      /* already unloaded */
    }
    setPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      // Do not leave a dead note registered as the active one, or the next note
      // played would try to pause something that no longer exists.
      if (activeVoicePause === pauseSelf) activeVoicePause = null;
      void soundRef.current?.unloadAsync();
    };
  }, [pauseSelf]);

  const bars = React.useMemo(() => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Array.from({ length: barCount }, (_, i) => {
      h ^= i + 1;
      h = Math.imul(h, 16777619);
      return 0.25 + (((h >>> 0) % 1000) / 1000) * 0.75;
    });
  }, [seed]);

  const toggle = useCallback(async () => {
    if (playing && sound) {
      await sound.pauseAsync();
      setPlaying(false);
      if (activeVoicePause === pauseSelf) activeVoicePause = null;
      return;
    }

    // Only one note at a time: starting this one silences any other.
    if (activeVoicePause && activeVoicePause !== pauseSelf) await activeVoicePause();
    activeVoicePause = pauseSelf;

    if (sound) {
      // If it finished a moment ago, start again from the beginning rather than
      // resuming at the very end and appearing to do nothing.
      const status = await sound.getStatusAsync();
      const atEnd =
        status.isLoaded &&
        typeof status.durationMillis === 'number' &&
        typeof status.positionMillis === 'number' &&
        status.positionMillis >= status.durationMillis - 250;
      if (atEnd) {
        await sound.setPositionAsync(0);
        setPosition(0);
      }
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
        // Reaching the end stops and rewinds, so the note sits paused at the
        // start ready to replay, instead of hanging at the last frame still
        // claiming to be playing.
        setPlaying(false);
        setPosition(0);
        void created.setPositionAsync(0);
        if (activeVoicePause === pauseSelf) activeVoicePause = null;
      }
    });
    setSound(created);
    await created.playAsync();
    setPlaying(true);
  }, [playing, sound, uri, pauseSelf]);

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
          const x = e.nativeEvent.locationX;
          void seek(clamp(x / 180, 0, 1));
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
  uploadOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(8,10,16,0.45)',
    borderRadius: radius.md,
  },
  overlayText: { color: '#fff', fontSize: fontSize.xs, marginTop: spacing.xs },
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
  viewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  viewerStage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: { position: 'absolute', top: 48, right: 20, padding: spacing.sm },
  zoomBar: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  zoomButton: { padding: spacing.xs },
});
