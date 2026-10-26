import React from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, fontWeight } from '@/theme';

/**
 * Each avatar gets its own two-stop gradient, chosen deterministically from the
 * seed.
 *
 * A flat colour per avatar made a list of initials read as a row of identical
 * chips. A gradient — and a wider set of them than the old seven — makes each
 * person distinguishable at a glance without anyone needing a photo. The pairs
 * are picked to sit on the dark surfaces without glowing.
 */
const AVATAR_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#7C5CE0', '#4B3A96'], // violet
  ['#3FA98F', '#1F6F63'], // teal
  ['#C98A3E', '#8A5A22'], // amber
  ['#4E9A5F', '#2C6B3F'], // green
  ['#C2557F', '#8A2F55'], // magenta
  ['#5B6EBD', '#33427E'], // indigo
  ['#3E9AA8', '#1F6570'], // cyan
  ['#9A6BC4', '#5C3B84'], // orchid
];

function gradientFor(seed: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0]!;
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
    <LinearGradient
      colors={gradientFor(seed ?? name)}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.base, dimension]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial(name)}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
  initial: { color: palette.text, fontWeight: fontWeight.semibold },
});
