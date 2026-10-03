import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { signOut } from '@/services/auth';
import { stopPresence } from '@/services/presence';
import { Avatar } from '@/components/Avatar';
import type { AppStackParamList } from '@/navigation/types';

export function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const profile = useAuthStore((s) => s.profile);
  const uid = useAuthStore((s) => s.uid);

  const handleSignOut = (): void => {
    Alert.alert('Sign out', 'You will need your phone number to sign back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          stopPresence();
          void signOut();
        },
      },
    ]);
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Pressable style={styles.profileRow} onPress={() => navigation.navigate('Profile')}>
        <Avatar name={profile?.displayName || 'You'} photoURL={profile?.photoURL} size={64} seed={uid ?? 'me'} />
        <View style={styles.profileBody}>
          <Text style={styles.name}>{profile?.displayName || 'Set your name'}</Text>
          <Text style={styles.about} numberOfLines={2}>{profile?.about || ''}</Text>
          {profile?.email ? <Text style={styles.phone}>{profile.email}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <Row icon="lock-closed-outline" title="End-to-end encryption" subtitle="Messages are encrypted on your device. Not even the server can read them." />
        <Row icon="key-outline" title="Safety numbers" subtitle="Open a chat, then verify the safety number with your contact to rule out tampering." />
        <Row icon="notifications-outline" title="Notifications" subtitle="Managed by your device settings." />
      </View>

      <Pressable style={styles.signOut} onPress={handleSignOut}>
        <Ionicons name="log-out-outline" size={20} color={palette.danger} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.version}>Chatter 1.0.0</Text>
    </ScrollView>
  );
}

function Row({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={22} color={palette.textMuted} />
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background },
  content: { padding: spacing.lg },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  profileBody: { flex: 1 },
  name: { color: palette.text, fontSize: fontSize.xl, fontWeight: fontWeight.semibold },
  about: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  phone: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2 },
  section: { marginTop: spacing.lg, borderTopWidth: 1, borderTopColor: palette.border },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: palette.border },
  rowBody: { flex: 1 },
  rowTitle: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  rowSubtitle: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 2, lineHeight: 18 },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl, paddingVertical: spacing.md },
  signOutText: { color: palette.danger, fontSize: fontSize.md, fontWeight: fontWeight.medium },
  version: { color: palette.textMuted, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.xl },
});
