import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { clearPendingOtp, getPendingOtp, setPendingOtp } from '@/services/otpSession';
import { requestOtp } from '@/services/auth';
import { friendlyAuthMessage } from '@/utils/errors';
import { formatPhoneDisplay } from '@/utils/phone';
import type { AuthScreenProps } from '@/navigation/types';

export function OtpScreen({ route }: AuthScreenProps<'Otp'>): React.JSX.Element {
  const { phone } = route.params;
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, []);

  const confirm = async (): Promise<void> => {
    const pending = getPendingOtp();
    if (!pending) {
      setError('Session expired. Go back and request a new code.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await pending.confirm(code);
      clearPendingOtp();
      // The auth listener in useAppBootstrap takes it from here.
    } catch (e) {
      setError(friendlyAuthMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    setError(null);
    try {
      const pending = await requestOtp(phone);
      setPendingOtp(pending);
      setCode('');
    } catch (e) {
      setError(friendlyAuthMessage(e));
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Enter the code</Text>
      <Text style={styles.sub}>We sent a 6-digit code to {formatPhoneDisplay(phone)}.</Text>

      <TextInput
        ref={inputRef}
        style={styles.input}
        value={code}
        onChangeText={(v) => setCode(v.replace(/[^\d]/g, '').slice(0, 6))}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="------"
        placeholderTextColor={palette.textMuted}
        onSubmitEditing={() => void confirm()}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.button, (busy || code.length < 6) && styles.buttonDisabled]}
        onPress={() => void confirm()}
        disabled={busy || code.length < 6}
      >
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Verify</Text>}
      </Pressable>

      <Pressable onPress={() => void resend()} style={styles.resend}>
        <Text style={styles.resendText}>Resend code</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl },
  heading: { color: palette.text, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginTop: spacing.xl },
  sub: { color: palette.textMuted, fontSize: fontSize.md, marginTop: spacing.sm, marginBottom: spacing.xl, lineHeight: 20 },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingVertical: spacing.md, textAlign: 'center', fontSize: 28, letterSpacing: 10 },
  button: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, marginTop: spacing.md, fontSize: fontSize.sm },
  resend: { marginTop: spacing.xl, alignItems: 'center' },
  resendText: { color: palette.green, fontSize: fontSize.md },
});
