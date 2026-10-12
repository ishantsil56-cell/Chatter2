import React from 'react';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { hitTarget } from '@/theme/tokens';

export interface IconButtonProps {
  name: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  size?: number;
  color?: string;
  /** Circular tinted background, for standalone buttons. */
  filled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  name,
  onPress,
  label,
  size = 22,
  color,
  filled = false,
  style,
}: IconButtonProps): React.JSX.Element {
  const theme = useTheme();
  const tint = color ?? theme.palette.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [
        styles.base,
        filled
          ? { backgroundColor: theme.palette.surfaceAlt, borderRadius: theme.radius.pill, width: 44, height: 44 }
          : null,
        pressed ? { opacity: 0.6, transform: [{ scale: 0.94 }] } : null,
        style,
      ]}
    >
      <Ionicons name={name} size={size} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minWidth: hitTarget - 8, minHeight: hitTarget - 8, alignItems: 'center', justifyContent: 'center' },
});
