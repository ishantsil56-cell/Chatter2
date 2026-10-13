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

export interface Mentionable {
  uid: string;
  username: string;
  displayName: string;
}

/**
 * The `#partial` the caret is sitting in, if any.
 *
 * Matches a `#` at the start of the text or after a space, then handle
 * characters, with nothing after it — so the picker only opens while the
 * handle is still being typed.
 */
const TRAILING_MENTION = /(?:^|\s)#([A-Za-z0-9._-]*)$/;

export interface MessageInputProps {
  /** Who can be mentioned. Empty (or absent) disables mentions entirely. */
  mentionables?: Mentionable[];
  onSendText: (text: string, mentions: string[]) => void;
  onSendImage: (image: PickedImage) => void;
  onSendVoice: (uri: string, durationMs: number, mimeType: string) => void;
  onKeystroke: () => void;
  onStopTyping: () => void;
  /** When set, a quoted strip appears above the input and the next send is a reply. */
  replyingTo?: { name: string; preview: string } | null;
  onCancelReply?: () => void;
}

export function MessageInput({
  mentionables,
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
  const [mentioned, setMentioned] = useState<string[]>([]);
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
    onSendText(trimmed, mentioned);
    setText('');
    setMentioned([]);
    onStopTyping();
  }, [text, mentioned, onSendText, onStopTyping]);

  // Which people to offer: the ones whose handle matches what is being typed.
  const partial = TRAILING_MENTION.exec(text)?.[1];
  const suggestions =
    partial === undefined || !mentionables?.length
      ? []
      : mentionables
          .filter((m) => m.username.toLowerCase().startsWith(partial.toLowerCase()))
          .slice(0, 6);

  /** Swap the half-typed `#partial` for the chosen handle and remember the uid. */
  const chooseMention = useCallback(
    (person: Mentionable) => {
      setText((current) => current.replace(TRAILING_MENTION, (whole) => {
        const lead = whole.startsWith('#') ? '' : whole[0];
        return `${lead}#${person.username} `;
      }));
      setMentioned((current) => (current.includes(person.uid) ? current : [...current, person.uid]));
    },
    [],
  );

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

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((person) => (
            <Pressable
              key={person.uid}
              style={styles.suggestionRow}
              onPress={() => chooseMention(person)}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${person.displayName}`}
            >
              <Text style={styles.suggestionName} numberOfLines={1}>
                {person.displayName}
              </Text>
              <Text style={styles.suggestionHandle}>#{person.username}</Text>
            </Pressable>
          ))}
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
  suggestions: {
    backgroundColor: palette.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingVertical: spacing.xs,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  suggestionName: { flex: 1, color: palette.text, fontSize: fontSize.md },
  suggestionHandle: { color: palette.accent, fontSize: fontSize.sm },
  inputWrap: { flex: 1, backgroundColor: palette.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, maxHeight: 120 },
  input: { color: palette.text, fontSize: fontSize.md, padding: 0 },
  iconButton: { padding: spacing.xs },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  recording: { backgroundColor: palette.danger },
});
