import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { palette, fontWeight } from '@/theme';

const AVATAR_COLORS = ['#5b6eae', '#a9778e', '#6f9f7c', '#c1975a', '#8a7bb8', '#5f9ea0', '#b56b6b'];

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

/** Up to two initials, taken by Unicode code point so emoji and Indic scripts never get cut in half. */
export function initial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  const first = Array.from(parts[0] ?? '')[0] ?? '';
  const second = Array.from(parts[1] ?? '')[0] ?? '';
  return (first + second).toUpperCase();
}

export interface AvatarProps {
  name: string;
  photoURL?: string | null;
  size?: number;
  seed?: string;
}

export function Avatar({ name, photoURL, size = 48, seed }: AvatarProps): React.JSX.Element {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={[styles.base, dimension]}
        accessibilityIgnoresInvertColors
        importantForAccessibility="no"
        accessible={false}
      />
    );
  }
  return (
    <View
      style={[styles.base, dimension, { backgroundColor: colorFor(seed ?? name) }]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: palette.text, fontWeight: fontWeight.semibold },
});
