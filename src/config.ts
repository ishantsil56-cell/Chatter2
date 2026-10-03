/**
 * App-wide configuration and feature flags.
 */

/**
 * Google Sign-In web client ID.
 *
 * Get this from the Firebase console:
 *   Authentication > Sign-in method > Google > expand "Web SDK configuration"
 *   and copy the "Web client ID" (it ends in .apps.googleusercontent.com).
 *
 * Paste it below, replacing the placeholder, then rebuild.
 */
export const GOOGLE_WEB_CLIENT_ID = 'REPLACE_WITH_YOUR_WEB_CLIENT_ID.apps.googleusercontent.com';

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
 *
 * The attach ("+") and microphone buttons only appear when this is true.
 */
export const MEDIA_ENABLED = false;

/**
 * PUSH_ENABLED gates FCM registration. Push notifications are delivered by a
 * Cloud Function, which needs the Blaze plan. Registration itself is free, so
 * this only affects whether the app bothers registering a token.
 */
export const PUSH_ENABLED = true;
