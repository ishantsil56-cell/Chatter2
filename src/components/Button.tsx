import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';
import { hitTarget } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  accessibilityHint?: string;
}

/**
 * The app's one button. Primary is a gradient, secondary a filled surface,
 * ghost a bare label, danger the semantic red. Every variant animates its press
 * state and meets the 48dp touch target.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
}: ButtonProps): React.JSX.Element {
  const theme = useTheme();
  const inactive = disabled || loading;

  const height = size === 'lg' ? 52 : 46;
  const textColor =
    variant === 'primary' || variant === 'danger'
      ? theme.palette.textInverse
      : variant === 'ghost'
        ? theme.palette.accent
        : theme.palette.text;

  const body = (
    <View style={[styles.inner, { height, opacity: inactive ? 0.5 : 1 }]}>
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={textColor} /> : null}
          <Text style={[theme.type.bodyStrong, { color: textColor }]}>{label}</Text>
        </>
      )}
    </View>
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        { borderRadius: theme.radius.md },
        fullWidth ? styles.full : null,
        pressed && !inactive ? { transform: [{ scale: 0.97 }] } : null,
        style,
      ]}
    >
      {variant === 'primary' ? (
        <LinearGradient
          colors={[theme.gradients.accent[0], theme.gradients.accent[1]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.fill, { borderRadius: theme.radius.md }]}
        >
          {body}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.fill,
            { borderRadius: theme.radius.md },
            variant === 'secondary' ? { backgroundColor: theme.palette.surfaceAlt } : null,
            variant === 'danger' ? { backgroundColor: theme.palette.danger } : null,
          ]}
        >
          {body}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: hitTarget, overflow: 'hidden' },
  full: { alignSelf: 'stretch' },
  fill: { justifyContent: 'center' },
  inner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 20 },
});
