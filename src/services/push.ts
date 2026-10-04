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
  const authStatus = await messaging().requestPermission();
  const enabled =
    authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
    authStatus === messaging.AuthorizationStatus.PROVISIONAL;
  if (!enabled) {
    log.warn('notification permission not granted');
    return;
  }

  const token = await messaging().getToken();
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
