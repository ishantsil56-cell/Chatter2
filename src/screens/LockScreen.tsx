import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { NumericKeypad } from '@/components/NumericKeypad';
import { useDialog } from '@/components/AppDialog';
import { useLockStore } from '@/store/lockStore';
import { useAuthStore } from '@/store/authStore';
import { signOut } from '@/services/auth';
import {
  PIN_LENGTH,
  authenticateBiometric,
  biometricsAvailable,
  clearPin,
  verifyPin,
} from '@/services/appLock';
import { scope } from '@/utils/logger';

const log = scope('LockScreen');

/**
 * The unlock screen.
 *
 * Every path out of here either unlocks or lands on sign-out. There is no way to
 * dismiss it, because a gate that can be dismissed is not a gate.
 */
export function LockScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const status = useLockStore((s) => s.status);
  const prefs = useLockStore((s) => s.prefs);
  const lockedUntil = useLockStore((s) => s.lockedUntil);
  const beginUnlock = useLockStore((s) => s.beginUnlock);
  const unlock = useLockStore((s) => s.unlock);
  const failAttempt = useLockStore((s) => s.failAttempt);

  const [digits, setDigits] = useState('');
  const [wrong, setWrong] = useState(false);
  const [now, setNow] = useState(Date.now());
  const triedBiometric = useRef(false);

  const cooling = lockedUntil > now;
  const remaining = Math.max(0, Math.ceil((lockedUntil - now) / 1000));

  // One tick a second while a cooldown is running, so the countdown moves.
  useEffect(() => {
    if (!cooling) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [cooling]);

  const submit = useCallback(
    async (pin: string) => {
      if (status !== 'locked' || cooling) return;
      beginUnlock();
      const ok = await verifyPin(pin);
      if (ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        unlock();
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setWrong(true);
      await failAttempt();
      // Hold the red state long enough to register, then clear the dots.
      setTimeout(() => {
        setWrong(false);
        setDigits('');
      }, 700);
    },
    [status, cooling, beginUnlock, unlock, failAttempt],
  );

  const onDigit = (digit: string): void => {
    if (cooling || wrong || status !== 'locked') return;
    const next = digits + digit;
    setDigits(next);
    if (next.length === PIN_LENGTH) void submit(next);
  };

  const tryBiometric = useCallback(async () => {
    if (status !== 'locked' || cooling) return;
    if (!prefs.biometrics) return;
    if (!(await biometricsAvailable())) return;
    beginUnlock();
    const ok = await authenticateBiometric();
    if (ok) {
      unlock();
      return;
    }
    // A cancelled or failed prompt must never dead-end: drop back to the keypad.
    useLockStore.setState({ status: 'locked' });
  }, [status, cooling, prefs.biometrics, beginUnlock, unlock]);

  // Offer the fingerprint once, unprompted, when the user asked for it.
  useEffect(() => {
    if (triedBiometric.current) return;
    if (status !== 'locked' || !prefs.biometrics) return;
    triedBiometric.current = true;
    void tryBiometric();
  }, [status, prefs.biometrics, tryBiometric]);

  const onForgot = (): void => {
    void (async () => {
      const ok = await dialog({
        title: 'Forgot PIN?',
        message:
          'Your PIN is stored only on this device, so it cannot be recovered. You will need to sign out and sign in again. Your messages stay on this device — only the lock is turned off.',
        confirmLabel: 'Sign Out',
        destructive: true,
      });
      if (!ok) return;
      // Clear the gate before signing out, or the user would be stuck on a
      // screen they cannot pass with a PIN that no longer exists.
      await clearPin();
      await useLockStore.getState().setPrefs({ enabled: false, biometrics: false });
      unlock();
      try {
        await signOut();
      } catch (e) {
        log.warn('could not sign out from the lock screen', e);
      } finally {
        useAuthStore.getState().reset();
      }
    })();
  };

  const dotColour = wrong ? palette.danger : palette.text;

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.top}>
        <Image
          source={require('../../assets/iris-eye.png')}
          style={[styles.eye, wrong && styles.eyeWrong]}
          resizeMode="contain"
        />
        <Text style={[styles.title, wrong && { color: palette.danger }]}>
          {wrong ? 'Wrong PIN' : 'Enter PIN'}
        </Text>

        <View style={styles.dots}>
          {Array.from({ length: PIN_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                i < digits.length && { borderColor: dotColour, backgroundColor: dotColour },
              ]}
            />
          ))}
        </View>
      </View>

      <View style={styles.bottom}>
        {cooling ? (
          <View style={styles.cooldown}>
            <Text style={styles.cooldownText}>Try again in {remaining}s</Text>
          </View>
        ) : (
          <NumericKeypad
            onDigit={onDigit}
            onBackspace={() => setDigits((d) => d.slice(0, -1))}
            onBiometric={prefs.biometrics ? () => void tryBiometric() : undefined}
            disabled={wrong || status !== 'locked'}
          />
        )}

        <Pressable
          onPress={onForgot}
          style={styles.forgot}
          accessibilityRole="button"
          accessibilityLabel="Forgot PIN"
        >
          <Text style={styles.forgotText}>Forgot PIN?</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: palette.backgroundSolid,
    paddingHorizontal: spacing.xl,
    justifyContent: 'space-between',
  },
  top: { alignItems: 'center', gap: spacing.lg, paddingTop: spacing.xl },
  eye: { width: 88, height: 88 },
  eyeWrong: { opacity: 0.55, tintColor: palette.danger },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: fontWeight.medium },
  dots: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.sm },
  dot: {
    width: 16,
    height: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
  },
  bottom: { gap: spacing.xl, alignItems: 'stretch' },
  cooldown: {
    backgroundColor: palette.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
  },
  cooldownText: { color: palette.text, fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  forgot: { alignSelf: 'center', padding: spacing.sm },
  forgotText: { color: palette.textMuted, fontSize: fontSize.sm },
});
