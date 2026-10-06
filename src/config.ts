/**
 * App-wide configuration and feature flags.
 */

/**
 * MEDIA_ENABLED gates photos and voice notes, which need Firebase Storage.
 * Cloud Storage for Firebase now requires the Blaze (pay-as-you-go) plan, so
 * this is OFF by default — the app ships as a fully working text messenger with
 * no payment method needed.
 *
 * To turn media on later:
 *   1. Enable Storage in the Firebase console (Blaze plan).
 *   2. Deploy the storage rules:  firebase deploy --only storage
 *   3. Flip MEDIA_ENABLED to true below and rebuild.
 */
export const MEDIA_ENABLED = false;

/**
 * PUSH_ENABLED gates FCM registration. Delivering a push needs server code (a
 * Cloud Function), which requires the Blaze plan — so on the free Spark plan
 * there is nothing to receive and registering would only trigger a pointless
 * permission prompt. Messages arrive live while the app is open. Flip this on
 * only if you add a server that sends pushes.
 */
export const PUSH_ENABLED = false;

/**
 * NOTIFICATIONS_ENABLED gates local message notifications.
 *
 * These are shown by the app itself when a message arrives while the app is
 * still running (in the foreground, or backgrounded but not yet killed by the
 * OS). They need no server and cost nothing.
 *
 * They are NOT the same as true push: with the app fully closed nothing can
 * reach it on the Spark plan, because delivering a push requires server code.
 * If a push relay is ever added, remote messages flow through FCM (see
 * push.ts) and these local ones keep working alongside it.
 */
export const NOTIFICATIONS_ENABLED = true;

/** The Android notification channel id. The tint comes from the theme palette. */
export const NOTIFICATION_CHANNEL_ID = 'messages';
