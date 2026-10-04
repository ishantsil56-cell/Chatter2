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
