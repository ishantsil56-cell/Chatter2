import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius } from '@/theme';
import { EPHEMERAL_TTLS, setEphemeralTtl, ttlLabel } from '@/services/disappearing';
import { friendlyError } from '@/utils/errors';
import type { ChatId } from '@/types';

/**
 * "Disappearing messages" setting row for a chat's info screen.
 * Shows the current timer; tapping opens the duration picker.
 */
export function DisappearingSettingRow({
  chatId,
  currentTtlMs,
  onError,
}: {
  chatId: ChatId;
  currentTtlMs?: number;
  onError?: (message: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const pick = async (ttlMs: number) => {
    setSaving(true);
    try {
      await setEphemeralTtl(chatId, ttlMs);
      setOpen(false);
    } catch (e) {
      onError?.(friendlyError(e, 'Couldn’t update disappearing messages.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Pressable
        style={styles.row}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Disappearing messages setting"
      >
        <Ionicons name="timer-outline" size={22} color={palette.accent} />
        <View style={styles.body}>
          <Text style={styles.title}>Disappearing messages</Text>
          <Text style={styles.sub}>
            {currentTtlMs ? `New messages disappear after ${ttlLabel(currentTtlMs)}` : 'Off'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close">
          <Pressable style={styles.card} onPress={() => undefined}>
            <Text style={styles.heading}>Disappearing messages</Text>
            <Text style={styles.note}>
              New messages in this chat will disappear after the chosen time. Applies to
              messages sent from now on.
            </Text>
            {EPHEMERAL_TTLS.map((t) => (
              <Pressable
                key={t.label}
                style={styles.option}
                onPress={() => void pick(t.ms)}
                disabled={saving}
                accessibilityRole="radio"
                accessibilityState={{ selected: (currentTtlMs ?? 0) === t.ms }}
                accessibilityLabel={t.label}
              >
                <Text style={styles.optionText}>{t.label}</Text>
                {(currentTtlMs ?? 0) === t.ms ? (
                  <Ionicons name="checkmark" size={20} color={palette.accent} />
                ) : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  body: { flex: 1 },
  title: { color: palette.text, fontSize: fontSize.md },
  sub: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'center', padding: spacing.xl },
  card: {
    backgroundColor: palette.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  heading: { color: palette.text, fontSize: fontSize.lg, fontWeight: '700', marginBottom: spacing.xs },
  note: { color: palette.textMuted, fontSize: fontSize.sm, marginBottom: spacing.md },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  optionText: { color: palette.text, fontSize: fontSize.md },
});
