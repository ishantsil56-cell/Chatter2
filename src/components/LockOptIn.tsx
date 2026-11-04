import React, { useEffect, useRef } from 'react';
import { useDialog } from '@/components/AppDialog';
import { useAuthStore } from '@/store/authStore';
import { useLockStore } from '@/store/lockStore';
import { hasBeenPrompted, markPrompted } from '@/services/appLock';
import { scope } from '@/utils/logger';

const log = scope('LockOptIn');

interface Props {
  /** Opens the set-up flow. Navigation lives in the shell, not here. */
  onSetup: () => void;
}

/**
 * Offers the app lock once, on the first signed-in launch of a device that has
 * none.
 *
 * A lock nobody discovers is a lock nobody uses, so the feature gets exactly one
 * unprompted mention. It is a dialog rather than a designed screen because the
 * designs show the set-up flow but not what leads into it, and inventing a
 * screen would have meant guessing at the one thing they were meant to decide.
 *
 * Three conditions, all deliberate: it waits until the user is signed in (there
 * is nothing to protect before that), until the gate is out of the way (it must
 * never appear over the lock screen it is offering to create), and it never
 * fires on a device that already has a lock.
 */
export function LockOptIn({ onSetup }: Props): null {
  const dialog = useDialog();
  const uid = useAuthStore((s) => s.uid);
  const hydrated = useLockStore((s) => s.hydrated);
  const status = useLockStore((s) => s.status);
  const enabled = useLockStore((s) => s.prefs.enabled);
  const asked = useRef(false);

  useEffect(() => {
    if (asked.current) return;
    if (!hydrated || status !== 'unlocked' || !uid || enabled) return;
    asked.current = true;
    void (async () => {
      try {
        if (await hasBeenPrompted()) return;
        // Recorded before the dialog opens. If the app dies mid-ask, the next
        // launch stays quiet — one missed offer is better than a prompt that
        // keeps returning.
        await markPrompted();
        const wantsLock = await dialog({
          title: 'Protect IRIS with a PIN?',
          message:
            'IRIS can ask for a 4-digit PIN, and your fingerprint, whenever it opens. It takes a moment to set up, and you can turn it off later in Settings.',
          confirmLabel: 'Set up',
          cancelLabel: 'Not now',
        });
        if (wantsLock) onSetup();
      } catch (e) {
        log.warn('could not offer the app lock', e);
      }
    })();
  }, [hydrated, status, uid, enabled, dialog, onSetup]);

  return null;
}
