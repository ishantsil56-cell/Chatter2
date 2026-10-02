import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize } from '@/theme';

export interface EmptyStateProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
}

export function EmptyState({ icon, title, subtitle }: EmptyStateProps): React.JSX.Element {
  return (
    <View style={styles.wrap}>
      <Ionicons name={icon} size={56} color={palette.textMuted} />
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  title: { color: palette.text, fontSize: fontSize.lg, fontWeight: '600', marginTop: spacing.sm, textAlign: 'center' },
  subtitle: { color: palette.textMuted, fontSize: fontSize.sm, textAlign: 'center' },
});
