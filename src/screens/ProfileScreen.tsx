import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { updateProfile } from '@/services/users';
import { storage } from '@/services/firebase';
import { Avatar } from '@/components/Avatar';
import { scope } from '@/utils/logger';
import type { AppScreenProps } from '@/navigation/types';

const log = scope('Profile');

export function ProfileScreen(_props: AppScreenProps<'Profile'>): React.JSX.Element {
  const uid = useAuthStore((s) => s.uid);
  const profile = useAuthStore((s) => s.profile);
  const [name, setName] = useState(profile?.displayName ?? '');
  const [about, setAbout] = useState(profile?.about ?? '');
  const [photoURL, setPhotoURL] = useState<string | null>(profile?.photoURL ?? null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      const url = await ref.getDownloadURL();
      setPhotoURL(url);
    } catch (e) {
      log.error('avatar upload failed', e);
    } finally {
      setUploading(false);
    }
  };

  const save = async (): Promise<void> => {
    if (!uid) return;
    setBusy(true);
    try {
      await updateProfile(uid, { displayName: name.trim(), about: about.trim(), photoURL });
    } catch (e) {
      log.error('save failed', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.avatarWrap} onPress={() => void pickPhoto()}>
        <Avatar name={name || 'You'} photoURL={photoURL} size={96} seed={uid ?? 'me'} />
        {uploading ? <ActivityIndicator style={styles.spinner} color={palette.green} /> : null}
        <Text style={styles.changePhoto}>Change photo</Text>
      </Pressable>

      <Text style={styles.label}>Name</Text>
      <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={palette.textMuted} />

      <Text style={styles.label}>About</Text>
      <TextInput style={[styles.input, styles.multiline]} value={about} onChangeText={setAbout} multiline placeholder="About" placeholderTextColor={palette.textMuted} />

      <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => void save()} disabled={busy}>
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Save</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl },
  avatarWrap: { alignItems: 'center', marginBottom: spacing.xl },
  spinner: { position: 'absolute', top: 38 },
  changePhoto: { color: palette.green, fontSize: fontSize.sm, marginTop: spacing.sm },
  label: { color: palette.green, fontSize: fontSize.sm, marginBottom: spacing.xs, marginTop: spacing.lg },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.md },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  disabled: { opacity: 0.6 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
