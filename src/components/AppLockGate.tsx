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
  if (status === 'unlocked') return null;
  return <LockScreen />;
}
