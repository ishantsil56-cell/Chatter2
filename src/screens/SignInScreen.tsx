import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { signInWithEmail, signUpWithEmail, sendPasswordReset, MIN_PASSWORD_LENGTH } from '@/services/auth';
import { isValidEmail, normalizeEmail } from '@/utils/email';
import { friendlyAuthMessage } from '@/utils/errors';
import { scope } from '@/utils/logger';

const log = scope('SignIn');

type Mode = 'signIn' | 'signUp';

export function SignInScreen(): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (): void => {
    setMode((m) => (m === 'signIn' ? 'signUp' : 'signIn'));
    setError(null);
    setNotice(null);
  };

  const validate = (): string | null => {
    if (!isValidEmail(email)) return 'Please enter a valid email address.';
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return null;
  };

  const submit = async (): Promise<void> => {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signUp') {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
      // The auth listener in useAppBootstrap takes it from here.
    } catch (e) {
      log.warn('auth failed', e);
      setError(friendlyAuthMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async (): Promise<void> => {
    if (!isValidEmail(email)) {
      setError('Enter your email first, then tap "Forgot password".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendPasswordReset(email);
      setNotice(`Password reset link sent to ${normalizeEmail(email)}.`);
    } catch (e) {
      setError(friendlyAuthMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.hero}>
        <View style={styles.logo}>
          <Ionicons name="chatbubbles" size={44} color={palette.textInverse} />
        </View>
        <Text style={styles.heading}>Welcome to Chatter</Text>
        <Text style={styles.sub}>
          {mode === 'signUp'
            ? 'Create an account to get started. Your messages are end-to-end encrypted.'
            : 'Sign in to continue. Your messages are end-to-end encrypted.'}
        </Text>
      </View>

      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        placeholderTextColor={palette.textMuted}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
      />

      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder={`Password (min ${MIN_PASSWORD_LENGTH} characters)`}
        placeholderTextColor={palette.textMuted}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={() => void submit()}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Pressable style={[styles.button, busy && styles.disabled]} onPress={() => void submit()} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={palette.textInverse} />
        ) : (
          <Text style={styles.buttonText}>{mode === 'signUp' ? 'Create account' : 'Sign in'}</Text>
        )}
      </Pressable>

      {mode === 'signIn' ? (
        <Pressable onPress={() => void forgot()} style={styles.linkRow} disabled={busy}>
          <Text style={styles.link}>Forgot password?</Text>
        </Pressable>
      ) : null}

      <Pressable onPress={switchMode} style={styles.linkRow} disabled={busy}>
        <Text style={styles.link}>
          {mode === 'signIn' ? "New here? Create an account" : 'Already have an account? Sign in'}
        </Text>
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl, justifyContent: 'center' },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
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
  input: {
    backgroundColor: palette.surfaceAlt,
    color: palette.text,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontSize: fontSize.md,
    marginBottom: spacing.md,
  },
  button: {
    backgroundColor: palette.green,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  disabled: { opacity: 0.6 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, fontSize: fontSize.sm, marginBottom: spacing.sm },
  notice: { color: palette.green, fontSize: fontSize.sm, marginBottom: spacing.sm },
  linkRow: { alignItems: 'center', marginTop: spacing.lg },
  link: { color: palette.green, fontSize: fontSize.sm },
});
