import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, fontSize, radius } from '@/theme';

export function DaySeparator({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <View style={styles.line} />
      <Text style={styles.text}>{label}</Text>
      <View style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  line: { flex: 1, height: 1, backgroundColor: '#1E2347' },
  text: {
    color: '#ADB1EE',
    fontSize: fontSize.xs,
    backgroundColor: '#141740',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontWeight: '500',
  },
});
