import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Audio } from 'expo-av';
import { palette, spacing, fontSize, radius } from '@/theme';
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
}

export function MessageInput({
  onSendText,
  onSendImage,
  onSendVoice,
  onKeystroke,
  onStopTyping,
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
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, gap: spacing.sm, backgroundColor: palette.surface },
  inputWrap: { flex: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, maxHeight: 120 },
  input: { color: palette.text, fontSize: fontSize.md, padding: 0 },
  iconButton: { padding: spacing.xs },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  recording: { backgroundColor: palette.danger },
});
