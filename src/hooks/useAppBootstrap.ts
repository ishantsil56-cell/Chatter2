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
import { publishPreKeys, deletePublishedPreKey } from '@/services/prekeys';
import { warmPlaintextCache, flushPlaintextCache } from '@/services/messageCache';
import { startChatSync } from '@/services/chatSync';
import { historyKeyState } from '@/services/historyKey';
import { AppState } from 'react-native';
import { registerForPush, onForegroundMessage, setBackgroundMessageHandler } from '@/services/push';
import { initNotifications } from '@/services/notifications';
import { PUSH_ENABLED } from '@/config';
import { startPresence, stopPresence } from '@/services/presence';
import { startOutbox } from '@/services/outbox';
import { primeIdentityKey } from '@/services/messages';
import { reportError } from '@/store/diagStore';
import { scope } from '@/utils/logger';

const log = scope('bootstrap');

export function useAppBootstrap(onNotification?: (title: string, body: string) => void): void {
  const setStatus = useAuthStore((s) => s.setStatus);
  const setUid = useAuthStore((s) => s.setUid);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setCryptoReady = useAuthStore((s) => s.setCryptoReady);
  const setHistoryState = useAuthStore((s) => s.setHistoryState);

  useEffect(() => {
    let cleanupAuth: (() => void) | undefined;
    let cleanupOutbox: (() => void) | undefined;
    let cleanupProfile: (() => void) | undefined;
    let cleanupAcks: (() => void) | undefined;
    let cleanupForeground: (() => void) | undefined;
    let cancelled = false;

    setBackgroundMessageHandler();

    // Persist the plaintext cache whenever the app leaves the foreground.
    const appSub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') void flushPlaintextCache();
    });

    void (async () => {
      try {
        const crypto = getCrypto();
        await crypto.init();
        await warmPlaintextCache();
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
          cleanupAcks?.();
          cleanupAcks = undefined;
          cleanupOutbox?.();
          cleanupOutbox = undefined;
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
            // Keep the server's one-time prekey pool in step with this device.
            crypto.setPreKeyListener({
              consumed: (id) => void deletePublishedPreKey(user.uid, id).catch((e) => log.warn('prekey delete failed', e)),
              replenished: () =>
                void publishPreKeys(user.uid, crypto.getIdentity()).catch((e) => log.warn('prekey republish failed', e)),
            });
            await publishPreKeys(user.uid, identity);
            if (PUSH_ENABLED) await registerForPush(user.uid);
            // Local message notifications: create the channel and ask permission.
            await initNotifications();
            startPresence(user.uid);
            setHistoryState(await historyKeyState(user.uid));
            cleanupOutbox?.();
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

        // Background sync for every chat: delivered receipts, decrypt-on-arrival (real
        // list previews), and answering "please resend" requests.
        cleanupAcks?.();
        cleanupAcks = startChatSync(getCrypto(), user.uid);
      });
    })();

    return () => {
      cancelled = true;
      cleanupAuth?.();
      cleanupOutbox?.();
      cleanupProfile?.();
      cleanupAcks?.();
      cleanupForeground?.();
      appSub.remove();
      stopPresence();
    };
  }, [setStatus, setUid, setProfile, setCryptoReady, setHistoryState, onNotification]);
}
