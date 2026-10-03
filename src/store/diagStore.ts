/**
 * A tiny diagnostics store.
 *
 * We can't read device logs from here, so any error the app hits is surfaced
 * on screen instead of disappearing. The overlay in App.tsx renders this.
 */

import { create } from 'zustand';

interface DiagState {
  lastError: string | null;
  setError(message: string | null): void;
}

export const useDiagStore = create<DiagState>((set) => ({
  lastError: null,
  setError: (lastError) => set({ lastError }),
}));

/** Record an error so the on-screen overlay can show it. */
export function reportError(e: unknown, context?: string): void {
  const msg = e instanceof Error ? e.message : String(e);
  useDiagStore.getState().setError(context ? `${context}: ${msg}` : msg);
}
