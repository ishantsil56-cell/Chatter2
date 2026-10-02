/**
 * A small design system. One place to change colours, spacing and type so the
 * whole app stays visually consistent. Values follow a WhatsApp-ish palette
 * (dark default) because the target look is a familiar messenger.
 */

export const palette = {
  // Brand
  green: '#00a884',
  greenDark: '#008069',
  teal: '#0b141a',

  // Surfaces (dark)
  background: '#0b141a',
  surface: '#111b21',
  surfaceAlt: '#202c33',
  surfaceHigh: '#2a3942',

  // Bubbles
  bubbleOut: '#005c4b',
  bubbleIn: '#202c33',
  bubbleSystem: '#182229',

  // Text
  text: '#e9edef',
  textMuted: '#8696a0',
  textInverse: '#111b21',

  // Status
  tick: '#53bdeb',
  danger: '#f15c6d',
  warning: '#ffbc38',

  // Lines
  border: '#2a3942',
  overlay: 'rgba(11,20,26,0.72)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Bubble corner radii — the little "tail" corner is squared off. */
export const bubbleRadius = {
  mine: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.sm },
  theirs: { borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, borderBottomLeftRadius: radius.sm, borderBottomRightRadius: radius.lg },
} as const;

export const theme = { palette, spacing, radius, fontSize, fontWeight } as const;

export type Theme = typeof theme;
