import React, { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /** Shown above the field; floats to the accent border on focus. */
  label?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** Renders a clear button while there is text. */
  onClear?: () => void;
  error?: string | null;
}

/**
 * A text field with an animated focus ring. The border lights up in the accent
 * colour on focus, which is the app's one interaction signal for "this is live".
 */
export function Input({ label, icon, onClear, error, value, ...rest }: InputProps): React.JSX.Element {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;

  const animate = (to: number): void => {
    Animated.timing(glow, {
      toValue: to,
      duration: theme.reduceMotion ? 0 : theme.motion.duration.fast,
      useNativeDriver: false, // borderColor cannot run on the native driver
    }).start();
  };

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [error ? theme.palette.danger : theme.palette.borderSoft, error ? theme.palette.danger : theme.palette.accent],
  });

  return (
    <View>
      {label ? (
        <Animated.Text
          style={[
            theme.type.label,
            { color: focused ? theme.palette.accent : theme.palette.textMuted, marginBottom: 6 },
          ]}
        >
          {label}
        </Animated.Text>
      ) : null}

      <Animated.View
        style={[
          styles.shell,
          {
            borderColor,
            backgroundColor: theme.palette.surfaceAlt,
            borderRadius: theme.radius.md,
          },
        ]}
      >
        {icon ? <Ionicons name={icon} size={18} color={theme.palette.textMuted} /> : null}
        <TextInput
          {...rest}
          value={value}
          onFocus={() => {
            setFocused(true);
            animate(1);
          }}
          onBlur={() => {
            setFocused(false);
            animate(0);
          }}
          placeholderTextColor={theme.palette.textMuted}
          style={[theme.type.body, styles.field, { color: theme.palette.text }]}
        />
        {onClear && value ? (
          <Pressable onPress={onClear} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={18} color={theme.palette.textMuted} />
          </Pressable>
        ) : null}
      </Animated.View>

      {error ? (
        <Animated.Text style={[theme.type.caption, { color: theme.palette.danger, marginTop: 6 }]}>
          {error}
        </Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, paddingHorizontal: 14, minHeight: 50 },
  field: { flex: 1, paddingVertical: 12 },
});
