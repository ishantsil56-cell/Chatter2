/**
 * App bootstrap: initialise crypto, wire up auth, publish keys, presence, push
 * and the offline outbox. Runs once from App.tsx.
 */

import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { getCrypto } from '@/services/crypto';
import { b64 } from '@/services/crypto/primitives';
import { onAuthStateChanged } from '@/services/auth';
import { ensureProfile, subscribeUser } from '@/services/users';
import { publishPreKeys } from '@/services/prekeys';
import { registerForPush, onForegroundMessage, setBackgroundMessageHandler } from '@/services/push';
import { PUSH_ENABLED } from '@/config';
import { startPresence, stopPresence } from '@/services/presence';
import { startOutbox } from '@/services/outbox';
import { primeIdentityKey, ackUndelivered } from '@/services/messages';
import { subscribeChats } from '@/services/chats';
import { reportError } from '@/store/diagStore';
import { scope } from '@/utils/logger';

const log = scope('bootstrap');

export function useAppBootstrap(onNotification?: (title: string, body: string) => void): void {
  const setStatus = useAuthStore((s) => s.setStatus);
  const setUid = useAuthStore((s) => s.setUid);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setCryptoReady = useAuthStore((s) => s.setCryptoReady);

  useEffect(() => {
    let cleanupAuth: (() => void) | undefined;
    let cleanupOutbox: (() => void) | undefined;
    let cleanupProfile: (() => void) | undefined;
    let cleanupAcks: (() => void) | undefined;
    let cleanupForeground: (() => void) | undefined;
    let cancelled = false;

    setBackgroundMessageHandler();

    void (async () => {
      try {
        const crypto = getCrypto();
        await crypto.init();
        if (cancelled) return;
        setCryptoReady(true);
        log.info('crypto ready');
      } catch (e) {
        log.error('crypto init failed', e);
        reportError(e, 'Crypto init');
      }

      cleanupForeground = onForegroundMessage((title, body) => onNotification?.(title, body));

      cleanupAuth = onAuthStateChanged((user) => {
        if (cancelled) return;
        if (!user) {
          stopPresence();
          setStatus('signedOut');
          setUid(null);
          return;
        }

        setUid(user.uid);

        void (async () => {
          try {
            const crypto = getCrypto();
            const identity = crypto.getIdentity();
            const { bundle } = crypto.getPublicPreKeys();

            await ensureProfile(user.uid, {
              email: user.email ?? '',
              username: '',
              displayName: user.displayName ?? undefined,
              photoURL: user.photoURL ?? undefined,
              identityKey: b64(bundle.identityKey),
              signingKey: b64(bundle.signingKey),
              signedPreKey: b64(bundle.signedPreKey),
              signedPreKeySignature: b64(bundle.signedPreKeySignature),
              preKeyId: bundle.signedPreKeyId,
            });
            primeIdentityKey(user.uid, b64(bundle.identityKey));
            await publishPreKeys(user.uid, identity);
            if (PUSH_ENABLED) await registerForPush(user.uid);
            startPresence(user.uid);
            cleanupOutbox = startOutbox(crypto);
          } catch (e) {
            log.error('post-login setup failed', e);
            reportError(e, 'Login setup');
          }
        })();

        cleanupProfile?.();
        cleanupProfile = subscribeUser(user.uid, (profile) => {
          setProfile(profile);
          setStatus(profile && profile.displayName && profile.username ? 'ready' : 'needsProfile');
        });

        // Mark incoming messages delivered as soon as they reach this device, so
        // the sender's tick becomes two checks without us having to open the
        // chat. Re-runs only when a chat's latest activity moves forward.
        cleanupAcks?.();
        const ackedAt = new Map<string, number>();
        cleanupAcks = subscribeChats(user.uid, (chats) => {
          for (const chat of chats) {
            const at = chat.lastMessageAt ?? 0;
            if ((ackedAt.get(chat.id) ?? 0) >= at) continue;
            ackedAt.set(chat.id, at);
            void ackUndelivered(chat.id, user.uid).catch(() => undefined);
          }
        });
      });
    })();

    return () => {
      cancelled = true;
      cleanupAuth?.();
      cleanupOutbox?.();
      cleanupProfile?.();
      cleanupAcks?.();
      cleanupForeground?.();
      stopPresence();
    };
  }, [setStatus, setUid, setProfile, setCryptoReady, onNotification]);
}
