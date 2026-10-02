import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, radius } from '@/theme';

export function DaySeparator({ label }: { label: string }): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginVertical: spacing.md },
  text: {
    color: palette.textMuted,
    fontSize: fontSize.xs,
    backgroundColor: palette.bubbleSystem,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontWeight: '500',
  },
});
