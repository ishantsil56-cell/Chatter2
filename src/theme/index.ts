/**
 * The IRIS design system.
 *
 * Near-black surfaces with a single violet accent, built around a "members only"
 * feel. This file is now just a re-export: the tokens themselves live in
 * ./tokens.ts and the live theme (accent choice, font scale, reduce motion) in
 * ./ThemeProvider.tsx.
 *
 * Every name that screens already import — `palette`, `spacing`, `radius`,
 * `fontSize`, `fontWeight`, `bubbleRadius` — is still exported from here, so the
 * migration to the new tokens needed no changes in the screens themselves.
 */

export * from './tokens';
export { ThemeProvider, useTheme, type Theme } from './ThemeProvider';
