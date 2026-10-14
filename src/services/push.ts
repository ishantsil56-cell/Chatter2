/**
 * Push notifications via Firebase Cloud Messaging.
 *
 * The device token is registered under users/{uid}/devices/{deviceId}. A Cloud
 * server (not included — Spark plan) would watch for new messages and push a
 * *content-free* notification ("New message") — the ciphertext is useless to
 * FCM, so the payload never contains the text.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { messaging } from './firebase';
import { registerDeviceToken } from './users';
import { reportError } from '@/store/diagStore';
import { randomId } from '@/utils/id';
import { scope } from '@/utils/logger';

const log = scope('push');
const DEVICE_ID_KEY = 'chatter.deviceId.v1';

export async function getDeviceId(): Promise<string> {
  let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = randomId(8);
    await AsyncStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function registerForPush(uid: string): Promise<void> {
  // Permission first, but note what this call actually does: on Android
  // `requestPermission` is a no-op that resolves AUTHORIZED (the real Android
  // runtime permission is POST_NOTIFICATIONS, which expo-notifications requests
  // in initNotifications). It genuinely prompts on iOS, which is the only place
  // the result is worth acting on.
  //
  // Kept narrow on purpose — an earlier version of this comment claimed Android
  // returned "not granted" here and that the token was therefore never
  // registered. That was wrong, and worth stating so nobody re-derives it.
  if (Platform.OS === 'ios') {
    const authStatus = await messaging().requestPermission();
    const enabled =
      authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
      authStatus === messaging.AuthorizationStatus.PROVISIONAL;
    if (!enabled) {
      log.warn('notification permission not granted');
      return;
    }
  }

  let token: string;
  try {
    token = await messaging().getToken();
  } catch (e) {
    // Surface this on screen: a failure here is invisible otherwise, and it is
    // the single most likely reason no push ever arrives.
    log.error('could not get an FCM token', e);
    reportError(e, 'Push token');
    return;
  }
  const deviceId = await getDeviceId();
  await registerDeviceToken(uid, deviceId, token, Platform.OS === 'ios' ? 'ios' : 'android');
  log.info(`registered FCM token for device ${deviceId}`);

  messaging().onTokenRefresh((newToken) => {
    void registerDeviceToken(uid, deviceId, newToken, Platform.OS === 'ios' ? 'ios' : 'android');
  });
}

/** Foreground messages don't show a system notification by default. */
export function onForegroundMessage(handler: (title: string, body: string) => void): () => void {
  return messaging().onMessage((remote) => {
    const title = remote.notification?.title ?? 'IRIS';
    const body = remote.notification?.body ?? 'New message';
    handler(title, body);
  });
}

/**
 * Register the background handler. Must be called at module scope, before the
 * React tree mounts — index.ts does this.
 */
export function setBackgroundMessageHandler(): void {
  messaging().setBackgroundMessageHandler(async () => {
    // Nothing to do: the notification is displayed by the OS. Data-only
    // messages would be handled here.
  });
}
