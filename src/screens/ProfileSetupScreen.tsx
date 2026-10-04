import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { ErrorBanner } from '@/components/ErrorBanner';
import { useAuthStore } from '@/store/authStore';
import { isUsernameAvailable, setUsername, updateProfile } from '@/services/users';
import { normalizeUsername, validateUsername } from '@/utils/username';
import { withTimeout } from '@/utils/async';
import { friendlyError } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('ProfileSetup');

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export function ProfileSetupScreen(): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const profile = useAuthStore((s) => s.profile);

  const [username, setUsernameValue] = useState(profile?.username ?? '');
  const [name, setName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? 'Hey there! I am using IRIS.');
  const [availability, setAvailability] = useState<Availability>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced availability check while typing.
  useEffect(() => {
    const handle = normalizeUsername(username);
    if (!handle) {
      setAvailability('idle');
      return;
    }
    const local = validateUsername(handle);
    if (!local.valid) {
      setAvailability('invalid');
      return;
    }
    setAvailability('checking');
    const t = setTimeout(() => {
      isUsernameAvailable(handle)
        .then((free) => setAvailability(free ? 'free' : 'taken'))
        .catch(() => setAvailability('idle'));
    }, 400);
    return () => clearTimeout(t);
  }, [username]);

  const save = async (): Promise<void> => {
    if (!uid) return;
    const handle = normalizeUsername(username);
    const check = validateUsername(handle);
    if (!check.valid) {
      setError(check.reason ?? 'Choose a valid username.');
      return;
    }
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await withTimeout(setUsername(uid, handle), 20000, 'Saving your username');
      await withTimeout(
        updateProfile(uid, { displayName: name.trim(), about: about.trim() }),
        20000,
        'Saving your profile',
      );
      // The profile subscription in useAppBootstrap flips status to `ready`.
    } catch (e) {
      log.error('save failed', e);
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const availabilityHint = (): { text: string; color: string } | null => {
    switch (availability) {
      case 'checking':
        return { text: 'Checking…', color: palette.textMuted };
      case 'free':
        return { text: 'Available', color: palette.accent };
      case 'taken':
        return { text: 'Already taken', color: palette.danger };
      case 'invalid':
        return { text: validateUsername(username).reason ?? 'Invalid', color: palette.danger };
      default:
        return null;
    }
  };
  const hint = availabilityHint();

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Set up your profile</Text>
      <Text style={styles.sub}>Your username is how others find and add you.</Text>

      <Text style={styles.label}>Username</Text>
      <View style={styles.usernameRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          style={styles.usernameInput}
          value={username}
          onChangeText={(v) => setUsernameValue(normalizeUsername(v))}
          placeholder="yourname"
          placeholderTextColor={palette.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {availability === 'checking' ? <ActivityIndicator color={palette.textMuted} /> : null}
      </View>
      {hint ? <Text style={[styles.hint, { color: hint.color }]}>{hint.text}</Text> : null}

      <Text style={styles.label}>Name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Your name"
        placeholderTextColor={palette.textMuted}
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

      <ErrorBanner message={error} />

      <Pressable
        style={[styles.button, (busy || availability === 'taken' || availability === 'invalid') && styles.disabled]}
        onPress={() => void save()}
        disabled={busy || availability === 'taken' || availability === 'invalid'}
      >
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl },
  heading: { color: palette.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.xl },
  sub: { color: palette.textMuted, fontSize: fontSize.md, marginTop: spacing.sm, marginBottom: spacing.xl },
  label: { color: palette.accent, fontSize: fontSize.sm, marginBottom: spacing.xs, marginTop: spacing.lg },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
  },
  at: { color: palette.textMuted, fontSize: fontSize.lg },
  usernameInput: { flex: 1, color: palette.text, paddingVertical: spacing.md, fontSize: fontSize.md },
  hint: { fontSize: fontSize.xs, marginTop: spacing.xs },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: palette.accent, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  disabled: { opacity: 0.5 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, marginTop: spacing.md, fontSize: fontSize.sm },
});
