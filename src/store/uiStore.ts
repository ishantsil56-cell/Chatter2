/**
 * UI preferences, persisted on the device.
 *
 * These are presentation only — nothing here touches messages, keys or auth.
 * Kept in its own store so a preference change re-renders the interface without
 * disturbing the data layer.
 */

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scope } from '@/utils/logger';

const log = scope('uiStore');
const KEY = 'iris.ui.v1';

export type AccentKey = 'violet' | 'indigo' | 'emerald' | 'crimson' | 'gold';

/** Preset accents. `accentAlt` is the second stop of the gradient. */
export const ACCENTS: Record<AccentKey, { label: string; accent: string; accentAlt: string; soft: string }> = {
  violet: { label: 'Violet', accent: '#7C3AED', accentAlt: '#4F46E5', soft: '#241C3D' },
  indigo: { label: 'Indigo', accent: '#4F46E5', accentAlt: '#2563EB', soft: '#1B2140' },
  emerald: { label: 'Emerald', accent: '#10B981', accentAlt: '#059669', soft: '#12302A' },
  crimson: { label: 'Crimson', accent: '#E11D48', accentAlt: '#BE123C', soft: '#331722' },
  gold: { label: 'Gold', accent: '#D4AF37', accentAlt: '#B8860B', soft: '#2E2716' },
};

export const FONT_SCALES = [0.9, 1, 1.15, 1.3] as const;

interface UiState {
  accent: AccentKey;
  /** Multiplier applied on top of the system font scale. */
  fontScale: number;
  haptics: boolean;
  reduceMotion: boolean;
  /** Obscure message previews in the chat list until a row is opened. */
  redactedPreviews: boolean;
  hydrated: boolean;

  setAccent(accent: AccentKey): void;
  setFontScale(fontScale: number): void;
  setHaptics(on: boolean): void;
  setReduceMotion(on: boolean): void;
  setRedactedPreviews(on: boolean): void;
  hydrate(): Promise<void>;
}

type Persisted = Pick<
  UiState,
  'accent' | 'fontScale' | 'haptics' | 'reduceMotion' | 'redactedPreviews'
>;

const DEFAULTS: Persisted = {
  accent: 'violet',
  fontScale: 1,
  haptics: true,
  reduceMotion: false,
  redactedPreviews: false,
};

async function persist(state: UiState): Promise<void> {
  const snapshot: Persisted = {
    accent: state.accent,
    fontScale: state.fontScale,
    haptics: state.haptics,
    reduceMotion: state.reduceMotion,
    redactedPreviews: state.redactedPreviews,
  };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch (e) {
    // A preference that fails to save is not worth interrupting anyone over.
    log.warn('could not save UI preferences', e);
  }
}

export const useUiStore = create<UiState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,

  setAccent: (accent) => {
    set({ accent });
    void persist(get());
  },
  setFontScale: (fontScale) => {
    set({ fontScale });
    void persist(get());
  },
  setHaptics: (haptics) => {
    set({ haptics });
    void persist(get());
  },
  setReduceMotion: (reduceMotion) => {
    set({ reduceMotion });
    void persist(get());
  },
  setRedactedPreviews: (redactedPreviews) => {
    set({ redactedPreviews });
    void persist(get());
  },

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Persisted>;
        set({
          ...DEFAULTS,
          ...saved,
          // Guard against a stale or hand-edited value.
          accent: saved.accent && saved.accent in ACCENTS ? saved.accent : DEFAULTS.accent,
        });
      }
    } catch (e) {
      log.warn('could not read UI preferences', e);
    } finally {
      set({ hydrated: true });
    }
  },
}));
