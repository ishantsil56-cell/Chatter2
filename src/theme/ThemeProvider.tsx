import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  palette as basePalette,
  spacing,
  radius,
  fonts,
  shadows,
  motion,
  type as baseType,
  bubbleRadius,
  type GradientPair,
  type Palette,
  type Shadows,
  type TypeScale,
} from './tokens';
import { ACCENTS, useUiStore } from '@/store/uiStore';

/**
 * The live theme.
 *
 * `tokens.ts` holds the defaults; this derives the *effective* values from the
 * user's preferences — a chosen accent, a font scale, reduce-motion — and hands
 * them to every screen through context. Changing the accent re-renders the app
 * instantly without a restart.
 */
export interface Theme {
  // Widened types, not `typeof basePalette`: the palette is `as const`, so its
  // entries are literal types like "#7C3AED", and a themed palette built at
  // runtime holds plain strings. Using the widened aliases keeps both valid.
  palette: Palette;
  spacing: typeof spacing;
  radius: typeof radius;
  fonts: typeof fonts;
  type: TypeScale;
  shadows: Shadows;
  bubbleRadius: typeof bubbleRadius;
  gradients: { accent: GradientPair };
  motion: typeof motion;
  /** When true, replace animations with plain fades. */
  reduceMotion: boolean;
  haptics: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

/** Scale a text token's size and line height together, so proportions hold. */
function scaleType(scale: number): TypeScale {
  if (scale === 1) return baseType;
  const out: Record<string, unknown> = {};
  for (const [name, style] of Object.entries(baseType)) {
    const s = style as { fontSize: number; lineHeight: number };
    out[name] = {
      ...s,
      fontSize: Math.round(s.fontSize * scale),
      lineHeight: Math.round(s.lineHeight * scale),
    };
  }
  return out as TypeScale;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const accent = useUiStore((s) => s.accent);
  const fontScale = useUiStore((s) => s.fontScale);
  const haptics = useUiStore((s) => s.haptics);
  const reduceMotion = useUiStore((s) => s.reduceMotion);
  const hydrate = useUiStore((s) => s.hydrate);
  const setReduceMotion = useUiStore((s) => s.setReduceMotion);

  // Load saved preferences once, at startup.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // If the phone itself asks for reduced motion, honour it on first run.
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (!cancelled && enabled) setReduceMotion(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setReduceMotion]);

  const theme = useMemo<Theme>(() => {
    const chosen = ACCENTS[accent] ?? ACCENTS.violet;
    return {
      palette: {
        ...basePalette,
        accent: chosen.accent,
        accentAlt: chosen.accentAlt,
        accentSoft: chosen.soft,
        tick: chosen.accent,
      },
      spacing,
      radius,
      fonts,
      type: scaleType(fontScale),
      shadows,
      bubbleRadius,
      gradients: { accent: [chosen.accent, chosen.accentAlt] },
      motion,
      reduceMotion,
      haptics,
    };
  }, [accent, fontScale, haptics, reduceMotion]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

/** The live theme. Falls back to the defaults if used outside the provider. */
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme) return theme;
  return {
    palette: basePalette,
    spacing,
    radius,
    fonts,
    type: baseType,
    shadows,
    bubbleRadius,
    gradients: { accent: [basePalette.accent, basePalette.accentAlt] },
    motion,
    reduceMotion: false,
    haptics: true,
  };
}
