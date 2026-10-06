/**
 * The IRIS design system.
 *
 * Near-black surfaces with a single violet accent — the colour of the IRIS
 * "third eye". One place to change colours, spacing and type so the whole app
 * stays visually consistent.
 *
 * NOTE: the primary brand colour is exported as `accent` (it used to be
 * `green`). Every screen refers to `palette.accent`, so re-branding again is a
 * one-line change here.
 */

export const palette = {
  // Brand — the violet of the IRIS "third eye"
  accent: '#7b68ee',
  accentDark: '#5a4bc4',
  accentSoft: '#2a2350',

  // Surfaces. `background` is deliberately slightly translucent so the app-wide
  // artwork (rendered once in App.tsx) shows through on every screen, while
  // staying dark enough to keep text readable.
  background: 'rgba(10,10,12,0.82)',
  backgroundSolid: '#0a0a0c',
  surface: '#121216',
  surfaceAlt: '#1c1c22',
  surfaceHigh: '#25252b',

  // Bubbles
  bubbleOut: '#4a3fa8',
  bubbleIn: '#1c1c22',
  bubbleSystem: '#16161b',

  // Text
  text: '#ededf2',
  textMuted: '#8a8a99',
  textInverse: '#0a0a0c',

  // Status
  tick: '#7b68ee',
  danger: '#f15c6d',
  warning: '#ffbc38',

  // Lines
  border: '#25252b',
  overlay: 'rgba(10,10,12,0.72)',
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
