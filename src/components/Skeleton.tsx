import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

/**
 * A shimmering placeholder. Runs on the native driver so a list full of these
 * still scrolls smoothly while data loads.
 */
export function Skeleton({ width = '100%', height = 14, radius, style }: SkeletonProps): React.JSX.Element {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    if (theme.reduceMotion) {
      pulse.setValue(0.5);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.75, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.35, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, theme.reduceMotion]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.sm,
          backgroundColor: theme.palette.surfaceAlt,
          opacity: pulse,
        },
        style,
      ]}
    />
  );
}

/** A ready-made chat-list row placeholder. */
export function SkeletonRow(): React.JSX.Element {
  const theme = useTheme();
  return (
    <View style={[styles.row, { paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm }]}>
      <Skeleton width={52} height={52} radius={26} />
      <View style={styles.body}>
        <Skeleton width="55%" height={14} />
        <Skeleton width="80%" height={12} style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { flex: 1 },
});
