import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '@/store/authStore';
import { useChat } from '@/hooks/useChat';
import { getCrypto } from '@/services/crypto';
import { sendMessage } from '@/services/messages';
import { validatePoll, encodePollBody } from '@/services/polls';
import { useDialog } from '@/components/AppDialog';
import { palette, spacing, fontSize, radius } from '@/theme';
import { scope } from '@/utils/logger';
import type { PollPayload } from '@/types/extended';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('PollCreateScreen');
const MAX_OPTIONS = 12;

const DEADLINES = [
  { label: 'No deadline', value: null as number | null },
  { label: '1 hour', value: 60 * 60 * 1000 },
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
  { label: '1 week', value: 7 * 24 * 60 * 60 * 1000 },
];

/**
 * Poll composer: question, 2–12 options, multi-select toggle, deadline.
 * The poll travels as a `kind: 'poll'` message whose JSON body is encrypted
 * with the normal E2E envelopes; votes live in a cleartext subcollection.
 */
export function PollCreateScreen({ route, navigation }: AppScreenProps<'PollCreate'>): React.JSX.Element {
  const { chatId } = route.params;
  const uid = useAuthStore((s) => s.uid);
  const { chat } = useChat(chatId, uid);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState<string[]>(['', '']);
  const [multiSelect, setMultiSelect] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const dialog = useDialog();

  const setOption = (i: number, v: string) =>
    setOptions((o) => o.map((x, j) => (j === i ? v : x)));
  const addOption = () => {
    if (options.length >= MAX_OPTIONS) return;
    setOptions((o) => [...o, '']);
  };
  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    setOptions((o) => o.filter((_, j) => j !== i));
  };

  const create = async () => {
    if (!uid || !chat || sending) return;
    const poll: PollPayload = {
      question: question.trim(),
      options: options.map((o) => o.trim()).filter(Boolean),
      closesAt: deadline == null ? null : Date.now() + deadline,
      multiSelect,
    };
    const err = validatePoll(poll);
    if (err) {
      await dialog({ title: 'Check the poll', message: err, confirmLabel: 'OK' });
      return;
    }
    setSending(true);
    try {
      await sendMessage(getCrypto(), {
        chatId,
        senderId: uid,
        memberIds: chat.memberIds,
        kind: 'poll',
        text: encodePollBody(poll),
      });
      navigation.goBack();
    } catch (e) {
      log.error('poll send failed', e);
      await dialog({
        title: 'Couldn’t send the poll',
        message: (e as Error).message,
        confirmLabel: 'OK',
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Question</Text>
      <TextInput
        style={styles.input}
        value={question}
        onChangeText={setQuestion}
        placeholder="Ask something…"
        placeholderTextColor={palette.textMuted}
        maxLength={255}
        accessibilityLabel="Poll question"
      />

      <Text style={styles.label}>Options</Text>
      {options.map((o, i) => (
        <View key={i} style={styles.optionRow}>
          <TextInput
            style={[styles.input, styles.optionInput]}
            value={o}
            onChangeText={(v) => setOption(i, v)}
            placeholder={`Option ${i + 1}`}
            placeholderTextColor={palette.textMuted}
            maxLength={100}
            accessibilityLabel={`Option ${i + 1}`}
          />
          {options.length > 2 ? (
            <Pressable
              onPress={() => removeOption(i)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove option ${i + 1}`}
            >
              <Ionicons name="close-circle-outline" size={24} color={palette.textMuted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {options.length < MAX_OPTIONS ? (
        <Pressable
          style={styles.addOption}
          onPress={addOption}
          accessibilityRole="button"
          accessibilityLabel="Add option"
        >
          <Ionicons name="add" size={20} color={palette.accent} />
          <Text style={styles.addOptionText}>Add option</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.toggleRow}
        onPress={() => setMultiSelect(!multiSelect)}
        accessibilityRole="switch"
        accessibilityLabel="Allow multiple answers"
        accessibilityState={{ checked: multiSelect }}
      >
        <Text style={styles.toggleLabel}>Allow multiple answers</Text>
        <Ionicons
          name={multiSelect ? 'checkbox' : 'square-outline'}
          size={24}
          color={multiSelect ? palette.accent : palette.textMuted}
        />
      </Pressable>

      <Text style={styles.label}>Voting deadline</Text>
      <View style={styles.deadlines}>
        {DEADLINES.map((d) => (
          <Pressable
            key={d.label}
            style={[styles.chip, deadline === d.value && styles.chipActive]}
            onPress={() => setDeadline(d.value)}
            accessibilityRole="button"
            accessibilityLabel={`Deadline ${d.label}`}
          >
            <Text style={[styles.chipText, deadline === d.value && styles.chipTextActive]}>
              {d.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.create, sending && styles.createDisabled]}
        onPress={() => void create()}
        disabled={sending}
        accessibilityRole="button"
        accessibilityLabel="Create poll"
      >
        <Text style={styles.createText}>{sending ? 'Sending…' : 'Create poll'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  content: { padding: spacing.md, gap: spacing.sm },
  label: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: spacing.sm },
  input: {
    backgroundColor: palette.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionInput: { flex: 1 },
  addOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm },
  addOptionText: { color: palette.accent, fontSize: fontSize.md },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  toggleLabel: { color: palette.text, fontSize: fontSize.md },
  deadlines: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
  },
  chipActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  chipText: { color: palette.textMuted, fontSize: fontSize.sm },
  chipTextActive: { color: palette.text },
  create: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  createDisabled: { opacity: 0.6 },
  createText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: '700' },
});
