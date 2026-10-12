import React from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

export interface ChipProps {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  selected?: boolean;
  /** Gold is reserved for honour marks; ordinary chips use the accent. */
  tone?: 'accent' | 'gold' | 'neutral';
  style?: ViewStyle;
}

export function Chip({ label, icon, onPress, selected = false, tone = 'accent', style }: ChipProps): React.JSX.Element {
  const theme = useTheme();
  const colour = tone === 'gold' ? theme.palette.gold : tone === 'neutral' ? theme.palette.textMuted : theme.palette.accent;

  const content = (
    <View style={styles.inner}>
      {icon ? <Ionicons name={icon} size={13} color={colour} /> : null}
      <Text style={[theme.type.label, { color: colour }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  const shell: ViewStyle = {
    borderRadius: theme.radius.pill,
    borderColor: selected ? colour : theme.palette.borderSoft,
    backgroundColor: selected ? theme.palette.accentSoft : 'transparent',
  };

  if (!onPress) return <View style={[styles.chip, shell, style]}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, shell, pressed ? { opacity: 0.7 } : null, style]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 5 },
});
