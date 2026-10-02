/**
 * Global auth / session state.
 *
 * `status` drives which navigator is shown:
 *   loading       -> splash
 *   signedOut     -> phone + OTP screens
 *   needsProfile  -> "set up your name" screen (first login)
 *   ready         -> the app
 */

import { create } from 'zustand';
import type { UserProfile } from '@/types';

export type AuthStatus = 'loading' | 'signedOut' | 'needsProfile' | 'ready';

interface AuthState {
  status: AuthStatus;
  uid: string | null;
  profile: UserProfile | null;
  /** True once the E2EE identity has been loaded/created. */
  cryptoReady: boolean;

  setStatus(status: AuthStatus): void;
  setUid(uid: string | null): void;
  setProfile(profile: UserProfile | null): void;
  setCryptoReady(ready: boolean): void;
  reset(): void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  uid: null,
  profile: null,
  cryptoReady: false,

  setStatus: (status) => set({ status }),
  setUid: (uid) => set({ uid }),
  setProfile: (profile) => set({ profile }),
  setCryptoReady: (cryptoReady) => set({ cryptoReady }),
  reset: () => set({ status: 'signedOut', uid: null, profile: null }),
}));
