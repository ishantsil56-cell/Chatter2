import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight } from '@/theme';
import { useAuthStore } from '@/store/authStore';
import { signOut, verifyPassword } from '@/services/auth';
import { unlockHistoryKey, startNewHistoryBackup, forgetLocalHistoryKey } from '@/services/historyKey';
import { ErrorBanner } from '@/components/ErrorBanner';
import { friendlyError } from '@/utils/errors';
import { stopPresence } from '@/services/presence';
import { Avatar } from '@/components/Avatar';
import { useDialog } from '@/components/AppDialog';
import { displayUsername } from '@/utils/username';
import type { AppStackParamList } from '@/navigation/types';

export function SettingsScreen(): React.JSX.Element {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const profile = useAuthStore((s) => s.profile);
  const uid = useAuthStore((s) => s.uid);
  const historyState = useAuthStore((s) => s.historyState);
  const setHistoryState = useAuthStore((s) => s.setHistoryState);
  const dialog = useDialog();

  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [offerNew, setOfferNew] = useState(false);

  const submitPassword = async (startNew = false): Promise<void> => {
    if (!uid) return;
    setPwBusy(true);
    setPwError(null);
    try {
      if (!(await verifyPassword(pw))) {
        setPwError('That password isn’t right.');
        return;
      }
      if (startNew) {
        await startNewHistoryBackup(uid, pw);
      } else {
        const result = await unlockHistoryKey(uid, pw);
        if (result === 'mismatch') {
          // The backup was made under an older password (e.g. before a reset).
          setOfferNew(true);
          setPwError('Your old backup was made with a different password, so it can’t be opened. You can start a new one — messages you sent before then will stay unreadable.');
          return;
        }
      }
      setHistoryState('ready');
      setPwOpen(false);
      setPw('');
      setOfferNew(false);
    } catch (e) {
      setPwError(friendlyError(e));
    } finally {
      setPwBusy(false);
    }
  };

  const handleSignOut = (): void => {
    void (async () => {
      const ok = await dialog({
        title: 'Sign out',
        message: 'Sign back in with your email and password any time.',
        confirmLabel: 'Sign out',
        destructive: true,
      });
      if (!ok) return;
      stopPresence();
      const leaving = uid;
      void signOut().finally(() => {
        if (leaving) void forgetLocalHistoryKey(leaving);
      });
    })();
  };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content}>
      <Pressable
        style={styles.profileRow}
        onPress={() => navigation.navigate('Profile')}
        accessibilityRole="button"
        accessibilityLabel={`Your profile, ${profile?.displayName || 'set your name'}`}
      >
        <Avatar name={profile?.displayName || 'You'} photoURL={profile?.photoURL} size={64} seed={uid ?? 'me'} />
        <View style={styles.profileBody}>
          <Text style={styles.name}>{profile?.displayName || 'Set your name'}</Text>
          <Text style={styles.about} numberOfLines={2}>{profile?.about || ''}</Text>
          {profile?.username ? <Text style={styles.phone}>{displayUsername(profile.username)}</Text> : null}
          {profile?.email ? <Text style={styles.phone}>{profile.email}</Text> : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
      </Pressable>

      <View style={styles.section}>
        <Row icon="lock-closed-outline" title="End-to-end encryption" subtitle="Messages are encrypted on your device. Not even the server can read them." />
        <Row icon="key-outline" title="Safety numbers" subtitle="Open a chat, then verify the safety number with your contact to rule out tampering." />
        <Row icon="notifications-outline" title="Notifications" subtitle="You’ll see new messages while IRIS is open." />
        {historyState === 'ready' ? (
          <Row icon="cloud-done-outline" title="Sent-message backup is on" subtitle="After a reinstall, sign in with the same password to read the messages you sent." />
        ) : historyState === 'needs-password' ? (
          <Pressable
            onPress={() => setPwOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="Turn on sent-message backup"
            accessibilityHint="Asks for your password"
          >
            <Row icon="cloud-upload-outline" title="Turn on sent-message backup" subtitle="Enter your password once so the messages you send can be re-read after a reinstall. The server only stores them encrypted." />
          </Pressable>
        ) : null}
      </View>

      <Modal visible={pwOpen} transparent animationType="fade" onRequestClose={() => setPwOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.rowTitle}>Confirm your password</Text>
            <TextInput
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Password"
              placeholderTextColor={palette.textMuted}
              style={styles.modalInput}
              accessibilityLabel="Account password"
            />
            <ErrorBanner message={pwError} />
            {pwBusy ? (
              <ActivityIndicator color={palette.accent} accessibilityLabel="Working" />
            ) : (
              <View style={styles.modalButtons}>
                <Pressable onPress={() => { setPwOpen(false); setPw(''); setPwError(null); setOfferNew(false); }} accessibilityRole="button" accessibilityLabel="Cancel">
                  <Text style={styles.modalCancel}>Cancel</Text>
                </Pressable>
                {offerNew ? (
                  <Pressable onPress={() => void submitPassword(true)} accessibilityRole="button" accessibilityLabel="Start a new backup">
                    <Text style={styles.modalOk}>Start new backup</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={() => void submitPassword(false)} accessibilityRole="button" accessibilityLabel="Confirm password">
                    <Text style={styles.modalOk}>Confirm</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      <Pressable style={styles.signOut} onPress={handleSignOut} accessibilityRole="button" accessibilityLabel="Sign out">
        <Ionicons name="log-out-outline" size={20} color={palette.danger} />
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>

      <Text style={styles.version}>IRIS 1.0.0</Text>
      <Text style={styles.madeBy}>MADE BY ISHANT SIL</Text>
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
  content: { padding: spacing.lg, paddingBottom: 112 },
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
  modalBackdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: spacing.xl },
  modalCard: { backgroundColor: palette.surface, borderRadius: 12, padding: spacing.lg, gap: spacing.md },
  modalInput: { color: palette.text, borderBottomWidth: 1, borderBottomColor: palette.border, paddingVertical: spacing.sm, fontSize: fontSize.md },
  modalButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.xl },
  modalCancel: { color: palette.textMuted, fontSize: fontSize.md },
  modalOk: { color: palette.accent, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  version: { color: palette.textMuted, fontSize: fontSize.xs, textAlign: 'center', marginTop: spacing.xl },
  madeBy: { color: palette.accent, fontSize: fontSize.xs, letterSpacing: 2, textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.lg },
});
