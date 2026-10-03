import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { isUsernameAvailable, setUsername, updateProfile } from '@/services/users';
import { storage } from '@/services/firebase';
import { normalizeUsername, validateUsername } from '@/utils/username';
import { messageOf } from '@/utils/errors';
import { Avatar } from '@/components/Avatar';
import { scope } from '@/utils/logger';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('Profile');

type Availability = 'idle' | 'checking' | 'free' | 'taken' | 'invalid';

export function ProfileScreen(_props: AppScreenProps<'Profile'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const profile = useAuthStore((s) => s.profile);

  const [username, setUsernameValue] = useState(profile?.username ?? '');
  const [name, setName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? '');
  const [photoURL, setPhotoURL] = useState<string | null>(profile?.photoURL ?? null);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const originalUsername = profile?.username ?? '';

  useEffect(() => {
    const handle = normalizeUsername(username);
    if (!handle || handle === originalUsername) {
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
  }, [username, originalUsername]);

  const pickPhoto = async (): Promise<void> => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted || !uid) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const ref = storage().ref(`avatars/${uid}.jpg`);
      await ref.putFile(asset.uri);
      setPhotoURL(await ref.getDownloadURL());
    } catch (e) {
      log.error('avatar upload failed', e);
    } finally {
      setUploading(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!uid) return;
    const handle = normalizeUsername(username);
    const check = validateUsername(handle);
    if (!check.valid) {
      setError(check.reason ?? 'Choose a valid username.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (handle !== originalUsername) {
        await setUsername(uid, handle);
      }
      await updateProfile(uid, { displayName: name.trim(), about: about.trim(), photoURL });
    } catch (e) {
      log.error('save failed', e);
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const hint =
    availability === 'checking'
      ? { text: 'Checking…', color: palette.textMuted }
      : availability === 'free'
        ? { text: 'Available', color: palette.green }
        : availability === 'taken'
          ? { text: 'Already taken', color: palette.danger }
          : availability === 'invalid'
            ? { text: validateUsername(username).reason ?? 'Invalid', color: palette.danger }
            : null;

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.avatarWrap} onPress={() => void pickPhoto()}>
        <Avatar name={name || 'You'} photoURL={photoURL} size={96} seed={uid ?? 'me'} />
        {uploading ? <ActivityIndicator style={styles.spinner} color={palette.green} /> : null}
        <Text style={styles.changePhoto}>Change photo</Text>
      </Pressable>

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
        />
        {availability === 'checking' ? <ActivityIndicator color={palette.textMuted} /> : null}
      </View>
      {hint ? <Text style={[styles.hint, { color: hint.color }]}>{hint.text}</Text> : null}

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={palette.textMuted} />

      <Text style={styles.label}>About</Text>
      <TextInput style={[styles.input, styles.multiline]} value={about} onChangeText={setAbout} multiline placeholder="About" placeholderTextColor={palette.textMuted} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, (busy || availability === 'taken' || availability === 'invalid') && styles.disabled]}
        onPress={() => void save()}
        disabled={busy || availability === 'taken' || availability === 'invalid'}
      >
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl },
  avatarWrap: { alignItems: 'center', marginBottom: spacing.lg },
  spinner: { position: 'absolute', top: 38 },
  changePhoto: { color: palette.green, fontSize: fontSize.sm, marginTop: spacing.sm },
  label: { color: palette.green, fontSize: fontSize.sm, marginBottom: spacing.xs, marginTop: spacing.lg },
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
  button: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  disabled: { opacity: 0.5 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, marginTop: spacing.md, fontSize: fontSize.sm },
});
