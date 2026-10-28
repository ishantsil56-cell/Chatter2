import React, { useRef } from 'react';
import { Animated, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

const AnimatedPressableBase = Animated.createAnimatedComponent(Pressable);

export interface AnimatedPressableProps extends Omit<PressableProps, 'style' | 'onPressIn' | 'onPressOut'> {
  /** Same contract as Pressable's style (falsy entries allowed) — but no
   * transform entries: the press scale owns transform. */
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed. 1 disables the effect. */
  pressScale?: number;
  onPressIn?: (event: GestureResponderEvent) => void;
  onPressOut?: (event: GestureResponderEvent) => void;
}

/**
 * The app's pressable with spring feedback: the whole element dips to
 * `pressScale` on press-in and springs back on release, instead of the flat
 * opacity flicker a bare Pressable gives. Respects the theme's reduce-motion
 * setting (no scale at all). One rule for callers: never pass a transform in
 * `style` — the animated scale is the transform, and a second one would
 * overwrite it.
 */
export function AnimatedPressable({
  style,
  pressScale = 0.96,
  onPressIn,
  onPressOut,
  children,
  ...props
}: AnimatedPressableProps): React.JSX.Element {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (to: number): void => {
    if (theme.reduceMotion || pressScale === 1) {
      scale.setValue(1);
      return;
    }
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  };

  return (
    <AnimatedPressableBase
      {...props}
      onPressIn={(event) => {
        animate(pressScale);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        onPressOut?.(event);
      }}
      style={[style, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedPressableBase>
  );
}
