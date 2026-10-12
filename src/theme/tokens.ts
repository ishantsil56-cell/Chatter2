/**
 * The IRIS design tokens.
 *
 * One place for every colour, size, shadow and animation value in the app. The
 * old `src/theme/index.ts` re-exports these, so nothing that already imports
 * `palette`, `spacing`, `radius` and friends had to change when this arrived.
 *
 * Names are deliberately kept stable where screens already use them
 * (`palette.accent`, `spacing.md`, `radius.lg`) — only the values moved to the
 * new "members only" palette.
 */

export const palette = {
  // --- Brand -------------------------------------------------------------
  // Deep violet to indigo. `accent` is the single accent used everywhere;
  // `accentAlt` exists to build the gradient pair with it.
  accent: '#7C3AED',
  accentAlt: '#4F46E5',
  accentDark: '#5B21B6',
  accentSoft: '#241C3D',
  /** Reserved for status and honour marks — never for ordinary UI. */
  gold: '#D4AF37',

  // --- Surfaces ----------------------------------------------------------
  // `background` stays slightly translucent so the app-wide artwork shows
  // through on every screen, as it does today.
  background: 'rgba(11,11,18,0.82)',
  backgroundSolid: '#0B0B12',
  surface: '#14141F',
  surfaceAlt: '#1C1C2B',
  surfaceHigh: '#25253A',

  // --- Bubbles -----------------------------------------------------------
  bubbleOut: '#4A3FA8',
  bubbleIn: '#1C1C2B',
  bubbleSystem: '#16161B',

  // --- Text (all AA against the surfaces above) --------------------------
  text: '#EDEDF2',
  textMuted: '#9A9AAE',
  textInverse: '#0B0B12',

  // --- Status ------------------------------------------------------------
  tick: '#7C3AED',
  danger: '#F15C6D',
  warning: '#FFBC38',
  success: '#3DD68C',

  // --- Lines -------------------------------------------------------------
  border: '#25253A',
  borderSoft: 'rgba(255,255,255,0.06)',
  overlay: 'rgba(11,11,18,0.72)',
} as const;

/** A 4pt grid. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 16,
  lg: 24,
  pill: 999,
} as const;

/** Kept for the message bubbles, which need their own asymmetric radii. */
export const bubbleRadius = {
  mine: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 18, borderBottomRightRadius: 4 },
  theirs: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderBottomLeftRadius: 4, borderBottomRightRadius: 18 },
} as const;

/**
 * Font families. These are the names expo-font registers from
 * @expo-google-fonts, so they must match the imported keys exactly.
 */
export const fonts = {
  display: 'Cinzel_700Bold',
  displayRegular: 'Cinzel_400Regular',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
} as const;

/**
 * The type scale. `fontSize` and `fontWeight` are kept in their original shape
 * because existing screens use them directly.
 */
export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  display: 34,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/** Ready-made text styles: family + size + line height in one token. */
export const type = {
  display: { fontFamily: fonts.display, fontSize: fontSize.display, lineHeight: 40, letterSpacing: 0.5 },
  title: { fontFamily: fonts.display, fontSize: fontSize.xxl, lineHeight: 32 },
  subtitle: { fontFamily: fonts.bodySemibold, fontSize: fontSize.lg, lineHeight: 24 },
  body: { fontFamily: fonts.body, fontSize: fontSize.md, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.bodySemibold, fontSize: fontSize.md, lineHeight: 21 },
  caption: { fontFamily: fonts.body, fontSize: fontSize.sm, lineHeight: 18 },
  label: { fontFamily: fonts.bodyMedium, fontSize: fontSize.xs, lineHeight: 15, letterSpacing: 0.6 },
} as const;

/** Elevation. Android reads elevation; iOS reads the shadow values. */
export const shadows = {
  soft: { elevation: 3, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  raised: { elevation: 8, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  glow: { elevation: 10, shadowColor: palette.accent, shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
} as const;

/** Gradient pairs for expo-linear-gradient. */
export const gradients = {
  accent: [palette.accent, palette.accentAlt] as const,
  accentSoft: ['rgba(124,58,237,0.22)', 'rgba(79,70,229,0.10)'] as const,
} as const;

/**
 * Motion. Durations stay in the 150–300ms band; entrances ease out, exits ease
 * in. Spring configs live here so every animation feels like the same app.
 */
export const motion = {
  duration: { fast: 150, base: 220, slow: 300 } as const,
  easing: {
    // Standard easings, named for intent rather than curve.
    enter: 'ease-out',
    exit: 'ease-in',
  },
  spring: { damping: 18, stiffness: 220, mass: 0.9 },
} as const;

/** Minimum touch target, per Android accessibility guidance. */
export const hitTarget = 48;
