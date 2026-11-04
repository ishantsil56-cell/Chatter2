import React from 'react';
import { useLockStore } from '@/store/lockStore';
import { LockScreen } from '@/screens/LockScreen';

/**
 * The gate.
 *
 * Rendered above everything else in the shell. When the store says unlocked it
 * renders nothing at all, so there is no invisible layer sitting over the app
 * swallowing touches.
 *
 * Note that App.tsx also refuses to mount the navigator while this is up. That
 * is the part that matters: an overlay alone would still have painted the chat
 * list for a frame on a cold start.
 */
export function AppLockGate(): React.JSX.Element | null {
  const status = useLockStore((s) => s.status);
  const hydrated = useLockStore((s) => s.hydrated);

  // Nothing at all until the stored preferences have been read.
  //
  // The status starts as `locked` so a real lock can never be beaten by a slow
  // read — but rendering on that provisional value made the lock screen flash
  // for a frame on every launch, even on a device with no lock set up, and then
  // vanish as the app opened. Waiting for hydration removes the flash without
  // weakening the guarantee: App.tsx does not mount the navigator until then
  // either, so there is still nothing behind this to glimpse.
  if (!hydrated) return null;
  if (status === 'unlocked') return null;
  return <LockScreen />;
}
