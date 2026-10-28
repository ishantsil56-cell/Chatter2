import React, { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface EntranceProps {
  children: React.ReactNode;
  /** Stagger delay in ms (chat rows pass their list index). */
  delay?: number;
  /** How far the content rises while fading in. */
  distance?: number;
  /** When true, renders immediately with no animation (already-seen rows). */
  immediate?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * One-shot mount entrance: fades in while rising `distance` px. Used for the
 * chat-list stagger and the sign-in hero. Runs once per mount, never on
 * scroll-back: callers that recycle (chat rows) pass `immediate` for rows
 * they have already shown. Respects reduce-motion by rendering at full
 * opacity immediately.
 */
export function Entrance({ children, delay = 0, distance = 12, immediate = false, style }: EntranceProps): React.JSX.Element {
  const theme = useTheme();
  const skip = immediate || theme.reduceMotion;
  const value = useRef(new Animated.Value(skip ? 1 : 0)).current;

  useEffect(() => {
    if (skip) return;
    const animation = Animated.timing(value, {
      toValue: 1,
      duration: 260,
      delay,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [value, delay, skip]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: value,
          transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
