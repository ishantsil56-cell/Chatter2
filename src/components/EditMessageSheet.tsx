import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AnimatedPressable } from './AnimatedPressable';
import { palette, spacing, fontSize, radius } from '@/theme';
import { friendlyError } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('EditMessageSheet');

export interface EditMessageSheetProps {
  visible: boolean;
  initialText: string;
  onClose: () => void;
  /** Persist the edit. Throw to surface an error. */
  onSave: (text: string) => Promise<void>;
}

/**
 * Simple editor for the 15-minute edit window. Text-only — media captions and
 * polls can't be edited, matching WhatsApp.
 */
export function EditMessageSheet({ visible, initialText, onClose, onSave }: EditMessageSheetProps): React.JSX.Element {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || trimmed === initialText.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (e) {
      log.warn('edit failed', e);
      setError(friendlyError(e, 'Couldn’t save the edit.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close editor">
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.heading}>Edit message</Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={4096}
            autoFocus
            accessibilityLabel="Edited message text"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <AnimatedPressable
              style={styles.cancel}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.save, saving && styles.saveDisabled]}
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel="Save edit"
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </AnimatedPressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: palette.overlay, justifyContent: 'flex-end' },
  card: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: { color: palette.text, fontSize: fontSize.lg, fontWeight: '700' },
  input: {
    backgroundColor: palette.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.text,
    fontSize: fontSize.md,
    padding: spacing.md,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  error: { color: palette.danger, fontSize: fontSize.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md },
  cancel: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  cancelText: { color: palette.textMuted, fontSize: fontSize.md },
  save: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: palette.textInverse, fontSize: fontSize.md, fontWeight: '700' },
});
