/**
 * Diagnostics.
 *
 * We cannot read device logs from here, so anything the app trips over is
 * recorded on the device and shown in the Diagnostics Centre. The overlay in
 * App.tsx still uses `lastError`; the list below is the history behind it.
 *
 * In memory only, deliberately. A crash log written to disk is a privacy
 * question — error strings can contain fragments of whatever failed — so the
 * history lasts for the session and is gone when the app is closed.
 */

import { create } from 'zustand';

export interface DiagEntry {
  at: number;
  message: string;
  context?: string;
}

/** How many errors to keep. Enough to see a pattern, not enough to bloat memory. */
const MAX_ENTRIES = 50;

interface DiagState {
  lastError: string | null;
  /** Newest first. */
  errors: DiagEntry[];
  setError(message: string | null): void;
  record(error: unknown, context?: string): void;
  clear(): void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

export const useDiagStore = create<DiagState>((set, get) => ({
  lastError: null,
  errors: [],

  setError: (lastError) => set({ lastError }),

  record: (error, context) => {
    const entry: DiagEntry = { at: Date.now(), message: messageOf(error), context };
    const label = context ? `${context}: ${entry.message}` : entry.message;
    set({
      lastError: label,
      errors: [entry, ...get().errors].slice(0, MAX_ENTRIES),
    });
  },

  clear: () => set({ lastError: null, errors: [] }),
}));

/** Record an error so the overlay and the Diagnostics Centre can show it. */
export function reportError(e: unknown, context?: string): void {
  useDiagStore.getState().record(e, context);
}
