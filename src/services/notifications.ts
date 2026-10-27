/**
 * Message notifications.
 *
 * IRIS is end-to-end encrypted, so the server only ever holds ciphertext and
 * cannot write a notification that says anything useful. Instead this device
 * notices a new message arrive (the background sync in chatSync.ts), decrypts
 * it locally, and shows its own notification. Nothing leaves the phone.
 *
 * These are LOCAL notifications: they fire while the app is still running —
 * in the foreground, or backgrounded and not yet killed by the OS. True push
 * to a fully closed app needs a server (see config.ts / push.ts).
 *
 * Everything here is tinted with the IRIS palette: the Android channel light
 * and the notification icon are both the violet accent, so a message from IRIS
 * looks like IRIS rather than a generic system alert.
 */

import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { palette } from '@/theme';
import { NOTIFICATION_CHANNEL_ID, NOTIFICATIONS_ENABLED } from '@/config';
import { useActiveChatStore } from '@/store/activeChatStore';
import { scope } from '@/utils/logger';

const log = scope('notifications');

/**
 * Let the system show what we present, even in the foreground — with one
 * exception: a notification for the chat the user is already reading.
 *
 * The local path used to suppress that case on its own, but the remote push
 * path never did — the handler below showed everything, so an empty
 * "New message" banner fired for every incoming message even mid-conversation.
 * Suppression is foreground-only: backgrounded, the user is not reading
 * anything, so the notification still has to fire. When the app is fully
 * closed this handler does not run at all, which is correct for the same
 * reason — nobody is reading the chat then.
 */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    const chatId = typeof data?.chatId === 'string' ? data.chatId : null;
    const suppress =
      AppState.currentState === 'active' &&
      chatId !== null &&
      useActiveChatStore.getState().activeChatId === chatId;
    return {
      shouldShowAlert: !suppress,
      shouldPlaySound: !suppress,
      shouldSetBadge: false,
    };
  },
});

/** One notification per chat, keyed so a new message replaces the last. */
function identifierFor(chatId: string): string {
  return `msg-${chatId}`;
}

/** Create the Android channel and ask for permission. Safe to call repeatedly. */
export async function initNotifications(): Promise<void> {
  if (!NOTIFICATIONS_ENABLED) return;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
        name: 'Messages',
        description: 'New IRIS messages',
        importance: Notifications.AndroidImportance.HIGH,
        // The IRIS violet, used for the notification's LED and accents.
        lightColor: palette.accent,
        vibrationPattern: [0, 250, 250, 250],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    if (existing.status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== 'granted') log.warn('notification permission not granted');
    }
  } catch (e) {
    log.warn('could not set up notifications', e);
  }
}

export interface MessageNotification {
  chatId: string;
  title: string;
  body: string;
}

/**
 * Show a message notification, unless the user is already looking at that chat.
 */
export async function presentMessageNotification(n: MessageNotification): Promise<void> {
  if (!NOTIFICATIONS_ENABLED) return;
  const inForeground = AppState.currentState === 'active';
  const readingThisChat = useActiveChatStore.getState().activeChatId === n.chatId;
  if (inForeground && readingThisChat) return;

  try {
    await Notifications.scheduleNotificationAsync({
      identifier: identifierFor(n.chatId),
      content: {
        title: n.title,
        body: n.body,
        // Tints the small icon with the IRIS violet on Android.
        color: palette.accent,
        data: { chatId: n.chatId },
      },
      // On Android the channel carries the violet light and the importance.
      // A channel-aware trigger still delivers immediately; the plugin's
      // `defaultChannel` only covers FCM messages, not these local ones.
      trigger: Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : null,
    });
  } catch (e) {
    log.warn('could not show notification', e);
  }
}

/** Clear a chat's notification once the user opens it. */
export async function dismissChatNotification(chatId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(identifierFor(chatId));
  } catch {
    // Nothing showing for this chat — fine.
  }
  // Remote pushes carry expo-generated identifiers, not msg-{chatId}, so
  // opening the chat never cleared them and the empty "New message" banners
  // piled up in the tray forever. Clear any presented notification whose
  // data names this chat.
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      if (n.request.content.data?.chatId === chatId) {
        await Notifications.dismissNotificationAsync(n.request.identifier);
      }
    }
  } catch {
    // Best effort — the local identifier above is the main path.
  }
}

/** Where a tapped notification wants to go, or null. */
export function chatIdFromResponse(response: Notifications.NotificationResponse | null): string | null {
  const data = response?.notification?.request?.content?.data;
  const chatId = data?.chatId;
  return typeof chatId === 'string' ? chatId : null;
}
