import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { palette, spacing, fontSize, radius, fontWeight } from '@/theme';
import { requestOtp } from '@/services/auth';
import { setPendingOtp } from '@/services/otpSession';
import { useSettingsStore } from '@/store/settingsStore';
import { isValidE164, toE164 } from '@/utils/phone';
import { friendlyAuthMessage } from '@/utils/errors';
import type { AuthScreenProps } from '@/navigation/types';

export function PhoneAuthScreen({ navigation }: AuthScreenProps<'Phone'>): React.JSX.Element {
  const countryCode = useSettingsStore((s) => s.countryCode);
  const setCountryCode = useSettingsStore((s) => s.setCountryCode);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const e164 = toE164(phone, countryCode);
    if (!isValidE164(e164)) {
      setError('Please enter a valid phone number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const pending = await requestOtp(e164);
      setPendingOtp(pending);
      navigation.navigate('Otp', { phone: e164 });
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
      <Text style={styles.heading}>Welcome to Chatter</Text>
      <Text style={styles.sub}>Enter your phone number to get started. We'll text you a code.</Text>

      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.ccInput]}
          value={countryCode}
          onChangeText={setCountryCode}
          keyboardType="phone-pad"
          maxLength={4}
        />
        <TextInput
          style={[styles.input, styles.phoneInput]}
          value={phone}
          onChangeText={setPhone}
          placeholder="98765 43210"
          placeholderTextColor={palette.textMuted}
          keyboardType="phone-pad"
          autoFocus
          onSubmitEditing={() => void submit()}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.button, busy && styles.buttonDisabled]} onPress={() => void submit()} disabled={busy}>
        {busy ? <ActivityIndicator color={palette.textInverse} /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>

      <Text style={styles.note}>
        By continuing you agree to keep this a friendly place. Your messages are end-to-end encrypted.
      </Text>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl, justifyContent: 'center' },
  heading: { color: palette.text, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  sub: { color: palette.textMuted, fontSize: fontSize.md, marginBottom: spacing.xl, lineHeight: 20 },
  row: { flexDirection: 'row', gap: spacing.sm },
  input: { backgroundColor: palette.surfaceAlt, color: palette.text, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontSize: fontSize.lg },
  ccInput: { width: 84, textAlign: 'center' },
  phoneInput: { flex: 1 },
  button: { backgroundColor: palette.green, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  error: { color: palette.danger, marginTop: spacing.md, fontSize: fontSize.sm },
  note: { color: palette.textMuted, fontSize: fontSize.xs, marginTop: spacing.xl, textAlign: 'center', lineHeight: 16 },
});
