import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
  /**
   * True while a photo or voice note is being encrypted and uploaded.
   *
   * Uploading a photo means reading it, sealing it and pushing several megabytes
   * out, which takes real time on a phone. Without this the screen is completely
   * still for those seconds and looks broken, which is exactly how it was
   * reported: "I can select a photo but nothing happens".
   */
  sendingMedia?: boolean;
  /** Surface a problem the composer itself hit, e.g. the picker refusing. */
  onError?: (message: string) => void;
  /** When set, a quoted strip appears above the input and the next send is a reply. */
  replyingTo?: { name: string; preview: string } | null;
  onCancelReply?: () => void;
  onCreatePoll?: () => void;
}

/**
 * A travelling sine wave, shown in place of the text field while recording.
 *
 * Each bar scales on its own delay, so the crest moves along the row instead of
 * the whole thing pulsing at once. Driven with the native driver, because this
 * runs while the microphone is open and the JS thread is busy starting the
 * recorder — a JS-driven animation here would stutter exactly when it matters.
 *
 * It reflects THAT recording is happening, not what is being said: expo-av
 * exposes no live input levels, and inventing them would be a lie.
 */
function RecordingWave(): React.JSX.Element {
  const bars = React.useRef(
    Array.from({ length: 22 }, () => new Animated.Value(0.25)),
  ).current;

  React.useEffect(() => {
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 45),
          Animated.timing(bar, { toValue: 1, duration: 340, useNativeDriver: true }),
          Animated.timing(bar, { toValue: 0.25, duration: 340, useNativeDriver: true }),
          Animated.delay((bars.length - i) * 45),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars]);

  return (
    <View style={styles.waveRow} accessibilityRole="progressbar" accessibilityLabel="Recording a voice message">
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[styles.waveBar, { transform: [{ scaleY: bar }] }]}
        />
      ))}
    </View>
  );
}

export function MessageInput({
  mentionables,
  onSendText,
  onSendImage,
  onSendVoice,
  onKeystroke,
  onStopTyping,
  sendingMedia,
  onError,
  replyingTo,
  onCancelReply,
  onCreatePoll,
}: MessageInputProps): React.JSX.Element {
  const [text, setText] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
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
  const people =
    partial === undefined || !mentionables?.length
      ? []
      : mentionables
          .filter((m) => m.username.toLowerCase().startsWith(partial.toLowerCase()))
          .slice(0, 6);
  // `#all` names the whole group. Offered first, and matched against "all" so it
  // appears as soon as you start typing it — a group-wide mention is usually the
  // thing you want when you reach for one.
  const showAll =
    partial !== undefined && mentionables && mentionables.length > 1 && 'all'.startsWith(partial.toLowerCase());
  const suggestions = people;

  /**
   * `#all` — mention the entire group.
   *
   * It resolves to every other member's uid rather than a sentinel, so the push
   * relay needs no special case: it already notifies the uids listed on the
   * message, and "everyone" is simply all of them.
   */
  const chooseAll = useCallback(() => {
    setText((current) =>
      current.replace(TRAILING_MENTION, (whole) => {
        const lead = whole.startsWith('#') ? '' : whole[0];
        return `${lead}#all `;
      }),
    );
    setMentioned(mentionables?.map((m) => m.uid) ?? []);
  }, [mentionables]);

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
    // Everything here used to be unguarded, and the caller does `void
    // pickImage()`, so any throw was swallowed and the screen simply did
    // nothing. Each way out now says why.
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError?.('IRIS needs permission to open your photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) {
        onError?.('That photo could not be read.');
        return;
      }
      onSendImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mimeType: asset.mimeType ?? 'image/jpeg',
      });
    } catch (e) {
      log.error('could not pick a photo', e);
      onError?.('Couldn’t open the photo picker.');
    }
  }, [onSendImage, onError]);

  const toggleRecording = useCallback(async () => {
    if (recording) {
      const durationMs = Date.now() - recordStart.current;
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      // Hand the audio session back to playback.
      //
      // Recording switches the session into capture mode, and nothing switched
      // it back. On Android that leaves the player running on a session set up
      // for the microphone, where playback does not reliably report that it has
      // finished — so a note would reach its end and simply stay there, looking
      // like it was still playing. expo-av expects this reset explicitly.
      try {
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false, playsInSilentModeIOS: true });
      } catch (e) {
        log.warn('could not restore playback audio mode', e);
      }
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

      {showAll || suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {showAll ? (
            <Pressable
              style={styles.suggestionRow}
              onPress={() => chooseAll()}
              accessibilityRole="button"
              accessibilityLabel="Mention everyone in the group"
            >
              <Text style={styles.suggestionName} numberOfLines={1}>
                Everyone
              </Text>
              <Text style={styles.suggestionHandle}>#all</Text>
            </Pressable>
          ) : null}
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
      <View style={styles.inputWrap}>
        {recording ? (
          <RecordingWave />
        ) : (
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
        )}
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
          style={[styles.micButton, recording ? styles.recording : null]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Stop recording and send voice message' : 'Record a voice message'}
        >
          {!recording ? (
            <LinearGradient colors={['#8C6BFA', '#8568F6']} style={StyleSheet.absoluteFill} />
          ) : null}
          <Ionicons name={recording ? 'stop' : 'mic'} size={20} color={palette.textInverse} />
        </Pressable>
      )}

      {MEDIA_ENABLED || onCreatePoll ? (
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={styles.accessButton}
          hitSlop={8}
          disabled={sendingMedia}
          accessibilityRole="button"
          accessibilityLabel={sendingMedia ? 'Sending your photo' : 'More options: photos and polls'}
        >
          {sendingMedia ? (
            <ActivityIndicator size="small" color={palette.accent} />
          ) : (
            <Ionicons name="accessibility-outline" size={26} color={palette.text} />
          )}
        </Pressable>
      ) : null}
      </View>

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} accessibilityLabel="Close menu">
          <View style={styles.menuCard}>
            {MEDIA_ENABLED ? (
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  setMenuOpen(false);
                  void pickImage();
                }}
                accessibilityRole="button"
                accessibilityLabel="Send a photo"
              >
                <Ionicons name="image-outline" size={22} color={palette.text} />
                <Text style={styles.menuLabel}>Photos</Text>
              </Pressable>
            ) : null}
            {onCreatePoll ? (
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  setMenuOpen(false);
                  onCreatePoll();
                }}
                accessibilityRole="button"
                accessibilityLabel="Create a poll"
              >
                <Ionicons name="bar-chart-outline" size={22} color={palette.text} />
                <Text style={styles.menuLabel}>Polls</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Modal>
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
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    backgroundColor: 'transparent',
  },
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
  inputWrap: {
    flex: 1,
    backgroundColor: '#0A0E2B',
    borderWidth: 1,
    borderColor: '#131442',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    maxHeight: 120,
  },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, height: 30 },
  waveBar: { width: 2.5, height: 26, borderRadius: 2, backgroundColor: palette.accent },
  input: { color: palette.text, fontSize: fontSize.md, padding: 0 },
  sendButton: { width: 48, height: 48, borderRadius: 24, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'transparent',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recording: { backgroundColor: palette.danger },
  accessButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: palette.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: palette.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  menuCard: {
    width: '100%',
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  menuLabel: { color: palette.text, fontSize: fontSize.md },
});
