import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius, spacing, fontSize } from '@/theme';
import { downloadAndDecrypt, parseMediaBody } from '@/services/storage';
import { formatDuration } from '@/utils/time';
import type { DecryptedMessage } from '@/types';

/**
 * Renders the encrypted attachment of a message: downloads, decrypts and shows
 * it. Media is only fetched on demand (when the bubble mounts).
 */
export function MediaContent({ message, isMine }: { message: DecryptedMessage; isMine: boolean }): React.JSX.Element | null {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = parseMediaBody(message.text);

  useEffect(() => {
    if (!message.media || !body) return;
    let cancelled = false;
    downloadAndDecrypt(message.media, body.key)
      .then((localUri) => {
        if (!cancelled) setUri(localUri);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [message.id, message.media, body]);

  if (!message.media) return null;

  if (error) {
    return (
      <View style={styles.placeholder}>
        <Ionicons name="warning-outline" size={18} color={palette.danger} />
        <Text style={styles.errorText}>Could not load attachment</Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator color={palette.textMuted} />
      </View>
    );
  }

  if (message.kind === 'image') {
    return (
      <Image
        source={{ uri }}
        style={[styles.image, { width: message.media.width ?? 220, height: message.media.height ?? 220 }]}
        resizeMode="cover"
      />
    );
  }

  if (message.kind === 'voice') {
    return <VoicePlayer uri={uri} durationMs={message.media.durationMs ?? 0} isMine={isMine} />;
  }

  // Generic file
  return (
    <View style={styles.fileRow}>
      <Ionicons name="document-outline" size={22} color={palette.text} />
      <Text style={styles.fileName} numberOfLines={1}>
        {message.media.fileName ?? 'Document'}
      </Text>
    </View>
  );
}

function VoicePlayer({ uri, durationMs, isMine }: { uri: string; durationMs: number; isMine: boolean }): React.JSX.Element {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    return () => {
      void sound?.unloadAsync();
    };
  }, [sound]);

  const toggle = async (): Promise<void> => {
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
      if (status.isLoaded && status.didJustFinish) {
        setPlaying(false);
        void created.setPositionAsync(0);
      }
    });
    setSound(created);
    await created.playAsync();
    setPlaying(true);
  };

  return (
    <Pressable style={styles.voiceRow} onPress={() => void toggle()}>
      <Ionicons name={playing ? 'pause' : 'play'} size={22} color={isMine ? palette.text : palette.accent} />
      <View style={styles.waveform} />
      <Text style={styles.duration}>{formatDuration(durationMs)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  placeholder: { width: 200, height: 120, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: palette.surfaceHigh },
  image: { borderRadius: radius.md, marginBottom: spacing.xs },
  errorText: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: spacing.xs },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  fileName: { color: palette.text, fontSize: fontSize.md, flexShrink: 1 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs, minWidth: 180 },
  waveform: { flex: 1, height: 2, backgroundColor: palette.textMuted, borderRadius: radius.pill },
  duration: { color: palette.textMuted, fontSize: fontSize.xs },
});
