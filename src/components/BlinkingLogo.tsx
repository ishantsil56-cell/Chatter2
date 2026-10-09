import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

const LOGO = require('../../assets/icon.png');

export interface BlinkingLogoProps {
  size?: number;
}

/**
 * The IRIS logo, gently fading in and out.
 *
 * Used in place of the rotating spinner on loading screens: it is the app's own
 * mark rather than a generic system indicator, and a soft blink reads as
 * "working" without the impatient feel of a spinner.
 *
 * Animated with React Native's own Animated API (opacity runs on the native
 * driver), so no extra dependency is needed.
 */
export function BlinkingLogo({ size = 96 }: BlinkingLogoProps): React.JSX.Element {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.2,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [opacity]);

  return (
    <Animated.Image
      source={LOGO}
      style={[styles.logo, { width: size, height: size, borderRadius: size * 0.22, opacity }]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="IRIS is loading"
    />
  );
}

const styles = StyleSheet.create({
  logo: { backgroundColor: 'transparent' },
});
