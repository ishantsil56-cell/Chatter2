import React, { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { Button } from '@/components/Button';
import { NumericKeypad } from '@/components/NumericKeypad';
import { useLockStore } from '@/store/lockStore';
import {
  PIN_LENGTH,
  biometricsAvailable,
  setPin,
  verifyPin,
} from '@/services/appLock';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AppScreenProps, AppStackParamList } from '@/navigation/types';

type Props = AppScreenProps<'LockSetup'>;

type Phase = 'pin' | 'confirm' | 'biometrics' | 'done';

/**
 * Set up a PIN, or change an existing one.
 *
 * Both flows share this screen because they are the same three questions asked
 * in a different order; only the labels and the verification step differ.
 */
export function LockSetupScreen({ route }: Props): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const mode = route.params?.mode ?? 'create';
  const setPrefs = useLockStore((s) => s.setPrefs);
  const currentBiometrics = useLockStore((s) => s.prefs.biometrics);

  const [phase, setPhase] = useState<Phase>('pin');
  const [digits, setDigits] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState<boolean | null>(null);

  const isChange = mode === 'change';

  const steps = isChange
    ? ['Enter Current PIN', 'Enter New PIN', 'Confirm New PIN']
    : ['Create PIN', 'Confirm PIN', 'Enable Biometrics'];

  // Create reads 1 Create, 2 Confirm, 3 Biometrics. Change reads 1 Current,
  // 2 New, 3 Confirm — so the same `confirm` phase sits on a different step.
  const activeStep =
    phase === 'pin' ? 0 : phase === 'confirm' ? (isChange && firstPin ? 2 : 1) : 2;

  const reset = (message?: string): void => {
    setDigits('');
    setError(message ?? null);
  };

  const advance = async (value: string): Promise<void> => {
    // Step one: either prove the old PIN, or choose a new one.
    if (phase === 'pin') {
      if (isChange) {
        const ok = await verifyPin(value);
        if (!ok) {
          reset('That PIN is not right');
          return;
        }
        setCurrentPin(value);
        setFirstPin('');
        setPhase('confirm');
        setDigits('');
        setError(null);
        return;
      }
      setFirstPin(value);
      setPhase('confirm');
      setDigits('');
      setError(null);
      return;
    }

    // Step two: the new PIN, twice.
    if (phase === 'confirm') {
      if (isChange && !firstPin) {
        setFirstPin(value);
        setDigits('');
        setError(null);
        return;
      }
      if (value !== firstPin) {
        reset('Those did not match');
        return;
      }
      await setPin(firstPin);
      if (isChange) {
        // No biometrics step when changing: the choice was already made.
        setPhase('done');
        return;
      }
      const available = await biometricsAvailable();
      setHasBiometrics(available);
      if (available) {
        setPhase('biometrics');
      } else {
        await finish(false);
      }
    }
  };

  const finish = async (biometrics: boolean): Promise<void> => {
    await setPrefs({ enabled: true, biometrics });
    setPhase('done');
  };

  const onDigit = (digit: string): void => {
    const next = digits + digit;
    setDigits(next);
    if (next.length === PIN_LENGTH) void advance(next);
  };

  const title = isChange ? 'Change PIN' : phase === 'biometrics' ? 'Enable Biometrics' : phase === 'done' ? 'Setup Complete' : 'Set up your PIN';

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {phase !== 'done' ? (
          <View style={styles.stepList}>
            {steps.map((label, i) => (
              <View key={label} style={styles.stepRow}>
                <View style={[styles.stepDot, i === activeStep && styles.stepDotActive]}>
                  <Text style={[styles.stepNum, i === activeStep && styles.stepNumActive]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepLabel, i === activeStep && styles.stepLabelActive]}>{label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {phase === 'pin' || phase === 'confirm' ? (
          <>
            <Text style={styles.caption}>
              {phase === 'pin'
                ? isChange
                  ? 'Enter your current PIN'
                  : `Enter ${PIN_LENGTH} digits`
                : isChange && !firstPin
                  ? 'Enter your new PIN'
                  : 'Re-enter your PIN'}
            </Text>
            <View style={styles.dots}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    i < digits.length && { borderColor: palette.accent, backgroundColor: palette.accent },
                    error && { borderColor: palette.danger },
                  ]}
                />
              ))}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <NumericKeypad
              onDigit={onDigit}
              onBackspace={() => setDigits((d) => d.slice(0, -1))}
            />
          </>
        ) : null}

        {phase === 'biometrics' ? (
          <View style={styles.centreBlock}>
            <Ionicons name="finger-print" size={64} color={palette.accentAlt} />
            <Text style={styles.biometricCopy}>
              Use your fingerprint or face to unlock IRIS faster.
            </Text>
            <Button label="Enable" onPress={() => void finish(true)} fullWidth />
            <Pressable
              onPress={() => void finish(false)}
              style={styles.skip}
              accessibilityRole="button"
              accessibilityLabel="Skip biometrics"
            >
              <Text style={styles.skipText}>Skip</Text>
            </Pressable>
            {currentBiometrics && !hasBiometrics ? (
              <Text style={styles.hint}>No fingerprint is set up on this device.</Text>
            ) : null}
          </View>
        ) : null}

        {phase === 'done' ? (
          <View style={styles.centreBlock}>
            <Image source={require('../../assets/iris-eye.png')} style={styles.doneEye} resizeMode="contain" />
            <Text style={styles.doneTitle}>All Set!</Text>
            <Text style={styles.biometricCopy}>
              {isChange
                ? 'Your PIN has been changed.'
                : `Your app is now locked with PIN${currentBiometrics ? ' and biometrics' : ''}.`}
            </Text>
            <Button label="Done" onPress={() => navigation.goBack()} fullWidth />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: palette.backgroundSolid },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerTitle: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  headerSpacer: { flex: 1 },
  body: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxl, gap: spacing.lg },
  stepList: { gap: spacing.sm, marginBottom: spacing.sm },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { borderColor: palette.accent, backgroundColor: palette.accentSoft },
  stepNum: { color: palette.textMuted, fontSize: fontSize.xs },
  stepNumActive: { color: palette.text },
  stepLabel: { color: palette.textMuted, fontSize: fontSize.sm },
  stepLabelActive: { color: palette.text },
  caption: { color: palette.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg, marginVertical: spacing.md },
  dot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  error: { color: palette.danger, fontSize: fontSize.sm, textAlign: 'center' },
  centreBlock: { alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xl },
  biometricCopy: { color: palette.textMuted, fontSize: fontSize.md, textAlign: 'center', lineHeight: 22 },
  skip: { padding: spacing.sm },
  skipText: { color: palette.textMuted, fontSize: fontSize.sm },
  hint: { color: palette.textMuted, fontSize: fontSize.xs, textAlign: 'center' },
  doneEye: { width: 96, height: 96 },
  doneTitle: { color: palette.text, fontSize: fontSize.xxl, fontWeight: fontWeight.semibold },
});
