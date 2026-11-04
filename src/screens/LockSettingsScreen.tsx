import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';
import { useLockStore } from '@/store/lockStore';
import { clearPin } from '@/services/appLock';
import type { AppStackParamList } from '@/navigation/types';

/** The auto-lock choices, in the order the design lists them. */
const AUTO_LOCK: { label: string; value: number }[] = [
  { label: 'Immediately', value: 0 },
  { label: '15 Seconds', value: 15_000 },
  { label: '1 Minute', value: 60_000 },
  { label: 'Never', value: -1 },
];

function autoLockLabel(ms: number): string {
  return AUTO_LOCK.find((o) => o.value === ms)?.label ?? '15 Seconds';
}

/**
 * Privacy & Security.
 *
 * Two views in one screen rather than two routes: the auto-lock list is a drill
 * down from this menu, and keeping it here avoids a stack entry that would
 * behave oddly if the lock re-locks while it is open.
 */
export function LockSettingsScreen(): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const prefs = useLockStore((s) => s.prefs);
  const setPrefs = useLockStore((s) => s.setPrefs);
  const [view, setView] = useState<'menu' | 'autoLock'>('menu');

  const onToggleBiometrics = (on: boolean): void => {
    void setPrefs({ biometrics: on });
  };

  const onToggleBlur = (on: boolean): void => {
    void setPrefs({ blurCover: on });
  };

  const onDisable = (): void => {
    // Turning the lock off removes the PIN entirely; leaving it behind would
    // mean a stale credential that nothing checks.
    void (async () => {
      await clearPin();
      await setPrefs({ enabled: false, biometrics: false });
      navigation.goBack();
    })();
  };

  const back = (): void => {
    if (view === 'autoLock') {
      setView('menu');
      return;
    }
    navigation.goBack();
  };

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={10} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={palette.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{view === 'autoLock' ? 'Auto-Lock' : 'Privacy & Security'}</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {view === 'menu' ? (
          <>
            <Pressable
              style={styles.row}
              onPress={() => navigation.navigate('LockSetup', { mode: 'change' })}
              accessibilityRole="button"
              accessibilityLabel="Change PIN"
            >
              <Ionicons name="lock-closed-outline" size={22} color={palette.textMuted} />
              <Text style={styles.rowLabel}>Change PIN</Text>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Pressable>

            <View style={styles.row}>
              <Ionicons name="finger-print" size={22} color={palette.textMuted} />
              <Text style={styles.rowLabel}>Biometrics</Text>
              <Switch
                value={prefs.biometrics}
                onValueChange={onToggleBiometrics}
                trackColor={{ false: palette.surfaceHigh, true: palette.accent }}
                thumbColor={palette.text}
                accessibilityLabel="Unlock with biometrics"
              />
            </View>

            <Pressable
              style={styles.row}
              onPress={() => setView('autoLock')}
              accessibilityRole="button"
              accessibilityLabel={`Auto-Lock, currently ${autoLockLabel(prefs.autoLockMs)}`}
            >
              <Ionicons name="time-outline" size={22} color={palette.textMuted} />
              <Text style={styles.rowLabel}>Auto-Lock</Text>
              <Text style={styles.rowValue}>{autoLockLabel(prefs.autoLockMs)}</Text>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Pressable>

            <View style={styles.row}>
              <Ionicons name="water-outline" size={22} color={palette.textMuted} />
              <Text style={styles.rowLabel}>Blur App in Background</Text>
              <Switch
                value={prefs.blurCover}
                onValueChange={onToggleBlur}
                trackColor={{ false: palette.surfaceHigh, true: palette.accent }}
                thumbColor={palette.text}
                accessibilityLabel="Blur the app in the background"
              />
            </View>

            <Text style={styles.note}>
              The cover hides IRIS in the recent-apps list. It does not stop screenshots of a
              conversation — that needs the system flag, which also blocks your own.
            </Text>

            <Pressable
              style={styles.disable}
              onPress={onDisable}
              accessibilityRole="button"
              accessibilityLabel="Turn off the app lock"
            >
              <Text style={styles.disableText}>Turn off app lock</Text>
            </Pressable>
          </>
        ) : (
          <View style={styles.optionList}>
            {AUTO_LOCK.map((option) => {
              const selected = prefs.autoLockMs === option.value;
              return (
                <Pressable
                  key={option.label}
                  style={styles.option}
                  onPress={() => {
                    void setPrefs({ autoLockMs: option.value });
                    setView('menu');
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={option.label}
                >
                  <View style={[styles.radio, selected && styles.radioOn]}>
                    {selected ? <View style={styles.radioDot} /> : null}
                  </View>
                  <Text style={styles.optionLabel}>{option.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
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
  body: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: palette.surfaceAlt,
  },
  rowLabel: { flex: 1, color: palette.text, fontSize: fontSize.md },
  rowValue: { color: palette.textMuted, fontSize: fontSize.sm },
  note: {
    color: palette.textMuted,
    fontSize: fontSize.xs,
    lineHeight: 17,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  disable: { alignSelf: 'center', padding: spacing.lg, marginTop: spacing.md },
  disableText: { color: palette.danger, fontSize: fontSize.md },
  optionList: { gap: spacing.xs },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: palette.accent },
  radioDot: { width: 11, height: 11, borderRadius: radius.pill, backgroundColor: palette.accent },
  optionLabel: { color: palette.text, fontSize: fontSize.md },
});
