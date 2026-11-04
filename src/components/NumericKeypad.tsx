import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';

export interface NumericKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  /** Shown in the bottom-left slot when provided. */
  onBiometric?: () => void;
  disabled?: boolean;
}

const ROWS: string[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * The one keypad, shared by unlock, set-up and change.
 *
 * Deliberately not the system keyboard: a numeric pad drawn by us cannot be
 * swapped for a third-party keyboard that might record what is typed, and it
 * keeps the lock screen's look consistent everywhere it appears.
 */
export function NumericKeypad({
  onDigit,
  onBackspace,
  onBiometric,
  disabled = false,
}: NumericKeypadProps): React.JSX.Element {
  const key = (digit: string): React.JSX.Element => (
    <Pressable
      key={digit}
      onPress={() => onDigit(digit)}
      disabled={disabled}
      style={({ pressed }) => [styles.key, pressed && !disabled && styles.keyPressed]}
      accessibilityRole="button"
      accessibilityLabel={digit}
    >
      <Text style={[styles.keyText, disabled && styles.keyTextDisabled]}>{digit}</Text>
    </Pressable>
  );

  return (
    <View style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.row}>
          {row.map(key)}
        </View>
      ))}
      <View style={styles.row}>
        {onBiometric ? (
          <Pressable
            onPress={onBiometric}
            disabled={disabled}
            style={({ pressed }) => [styles.key, pressed && !disabled && styles.keyPressed]}
            accessibilityRole="button"
            accessibilityLabel="Unlock with fingerprint or face"
          >
            <Ionicons name="finger-print" size={26} color={palette.accentAlt} />
          </Pressable>
        ) : (
          <View style={styles.key} />
        )}
        {key('0')}
        <Pressable
          onPress={onBackspace}
          disabled={disabled}
          style={({ pressed }) => [styles.key, pressed && !disabled && styles.keyPressed]}
          accessibilityRole="button"
          accessibilityLabel="Delete last digit"
        >
          <Ionicons name="backspace-outline" size={24} color={palette.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { alignSelf: 'stretch', gap: spacing.md },
  row: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  key: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.borderSoft,
  },
  keyPressed: { backgroundColor: palette.surfaceHigh },
  keyText: { color: palette.text, fontSize: fontSize.xxl, fontWeight: fontWeight.medium },
  keyTextDisabled: { color: palette.textMuted },
});
