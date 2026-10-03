import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { signInWithGoogle } from '@/services/auth';
import { friendlyAuthMessage, friendlyGoogleMessage } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('SignIn');

const GOOGLE_CODES = ['SIGN_IN_CANCELLED', 'IN_PROGRESS', 'PLAY_SERVICES_NOT_AVAILABLE'];

export function SignInScreen(): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // The auth listener in useAppBootstrap handles the rest.
    } catch (e) {
      const code = (e as { code?: string } | undefined)?.code ?? '';
      if (code === 'SIGN_IN_CANCELLED') {
        // User backed out — no need to shout about it.
        log.debug('user cancelled sign-in');
      } else {
        log.warn('sign-in failed', e);
        setError(GOOGLE_CODES.includes(code) ? friendlyGoogleMessage(e) : friendlyAuthMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="chatbubbles" size={44} color={palette.textInverse} />
        </View>
        <Text style={styles.heading}>Welcome to Chatter</Text>
        <Text style={styles.sub}>
          Sign in with your Google account to get started. Your messages are end-to-end encrypted.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.googleButton, busy && styles.disabled]}
        onPress={() => void handleSignIn()}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color={palette.textInverse} />
        ) : (
          <>
            <Ionicons name="logo-google" size={20} color={palette.textInverse} />
            <Text style={styles.googleText}>Continue with Google</Text>
          </>
        )}
      </Pressable>

      <Text style={styles.note}>
        We only use your name, email and photo to set up your profile.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl, justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: spacing.xxl },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: palette.green,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  heading: { color: palette.text, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, textAlign: 'center' },
  sub: {
    color: palette.textMuted,
    fontSize: fontSize.md,
    marginTop: spacing.sm,
    lineHeight: 20,
    textAlign: 'center',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: palette.green,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
  },
  disabled: { opacity: 0.6 },
  googleText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, fontSize: fontSize.sm, marginBottom: spacing.lg, textAlign: 'center' },
  note: { color: palette.textMuted, fontSize: fontSize.xs, marginTop: spacing.xl, textAlign: 'center', lineHeight: 16 },
});
