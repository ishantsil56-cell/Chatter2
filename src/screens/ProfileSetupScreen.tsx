import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { updateProfile } from '@/services/users';
import { scope } from '@/utils/logger';

const log = scope('ProfileSetup');

export function ProfileSetupScreen(): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const profile = useAuthStore((s) => s.profile);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? 'Hey there! I am using Chatter.');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (!uid || !name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await updateProfile(uid, { displayName: name.trim(), about: about.trim() });
      // The profile subscription in useAppBootstrap flips status to `ready`.
    } catch (e) {
      log.error('save failed', e);
      setError('Could not save your profile. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Set up your profile</Text>
      <Text style={styles.sub}>This is how others will see you.</Text>

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={palette.textMuted}
        autoFocus
      />

      <Text style={styles.label}>About</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={about}
        onChangeText={setAbout}
        placeholder="About"
        placeholderTextColor={palette.textMuted}
        multiline
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={() => void save()} disabled={busy}>
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl },
  heading: { color: palette.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.xl },
  sub: { color: palette.textMuted, fontSize: fontSize.md, marginTop: spacing.sm, marginBottom: spacing.xl },
  label: { color: palette.green, fontSize: fontSize.sm, marginBottom: spacing.xs, marginTop: spacing.lg },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, marginTop: spacing.md, fontSize: fontSize.sm },
});
