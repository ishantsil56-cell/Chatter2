import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { MEDIA_ENABLED } from '@/config';
import { scope } from '@/utils/logger';

const log = scope('MessageInput');

export interface PickedImage {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
}

export interface MessageInputProps {
  onSendText: (text: string) => void;
  onSendImage: (image: PickedImage) => void;
  onSendVoice: (uri: string, durationMs: number, mimeType: string) => void;
  onKeystroke: () => void;
  onStopTyping: () => void;
  /** When set, a quoted strip appears above the input and the next send is a reply. */
  replyingTo?: { name: string; preview: string } | null;
  onCancelReply?: () => void;
}

export function MessageInput({
  onSendText,
  onSendImage,
  onSendVoice,
  onKeystroke,
  onStopTyping,
  replyingTo,
  onCancelReply,
}: MessageInputProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const recordStart = useRef<number>(0);

  const handleChange = useCallback(
    (value: string) => {
      setText(value);
      onKeystroke();
    },
    [onKeystroke],
  );

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSendText(trimmed);
    setText('');
    onStopTyping();
  }, [text, onSendText, onStopTyping]);

  const pickImage = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    onSendImage({
      uri: asset.uri,
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType ?? 'image/jpeg',
    });
  }, [onSendImage]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      const durationMs = Date.now() - recordStart.current;
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) onSendVoice(uri, durationMs, 'audio/m4a');
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    try {
      const { recording: created } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordStart.current = Date.now();
      setRecording(created);
    } catch (e) {
      log.error('could not start recording', e);
    }
  }, [recording, onSendVoice]);

  const hasText = text.trim().length > 0;

  return (
    <View>
      {replyingTo ? (
        <View style={styles.replyStrip}>
          <View style={styles.replyRule} />
          <View style={styles.replyBody}>
            <Text style={styles.replyName} numberOfLines={1}>
              {replyingTo.name}
            </Text>
            <Text style={styles.replyPreview} numberOfLines={1}>
              {replyingTo.preview}
            </Text>
          </View>
          <Pressable onPress={onCancelReply} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel reply">
            <Ionicons name="close" size={18} color={palette.textMuted} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.wrap}>
      {MEDIA_ENABLED ? (
        <Pressable onPress={() => void pickImage()} style={styles.iconButton} hitSlop={8} accessibilityRole="button" accessibilityLabel="Attach a photo">
          <Ionicons name="add" size={26} color={palette.textMuted} />
        </Pressable>
      ) : null}

      <View style={styles.inputWrap}>
        <TextInput
          value={text}
          onChangeText={handleChange}
          placeholder="Message"
          placeholderTextColor={palette.textMuted}
          style={styles.input}
          multiline
          accessibilityLabel="Message"
          accessibilityHint="Type a message to send"
        />
      </View>

      {hasText || !MEDIA_ENABLED ? (
        <Pressable
          onPress={handleSend}
          style={[styles.sendButton, !hasText && styles.sendDisabled]}
          disabled={!hasText}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !hasText }}
        >
          <Ionicons name="send" size={20} color={palette.textInverse} />
        </Pressable>
      ) : (
        <Pressable
          onPress={() => void toggleRecording()}
          style={[styles.sendButton, recording ? styles.recording : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording and send voice message' : 'Record a voice message'}
        >
          <Ionicons name={recording ? 'stop' : 'mic'} size={20} color={palette.textInverse} />
        </Pressable>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  replyStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  replyRule: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: palette.accent },
  replyBody: { flex: 1 },
  replyName: { color: palette.accent, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  replyPreview: { color: palette.textMuted, fontSize: fontSize.sm },
  wrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: palette.surface },
  inputWrap: { flex: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, maxHeight: 120 },
  input: { color: palette.text, fontSize: fontSize.md, padding: 0 },
  iconButton: { padding: spacing.xs },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  recording: { backgroundColor: palette.danger },
});
