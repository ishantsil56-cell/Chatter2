/**
 * App-wide configuration and feature flags.
 */

/**
 * MEDIA_ENABLED gates photos and voice notes.
 *
 * ON. Media used to need Cloud Storage for Firebase, which requires the Blaze
 * plan — that is why this was off. It now goes to Cloudflare R2 instead, which
 * has a real free tier (10 GB, and no egress charge), so photos and voice notes
 * work without a payment method anywhere.
 *
 * The security model is unchanged from when Storage was the plan: the file is
 * encrypted on the device with a random per-file key BEFORE it is uploaded, and
 * that key travels inside the end-to-end encrypted message body. R2 only ever
 * holds ciphertext, and only the recipient can read it.
 *
 * Requires the R2 bucket and the Worker binding described in wrangler.toml.
 */
export const MEDIA_ENABLED = true;

/**
 * Base URL of the Cloudflare Worker.
 *
 * It serves two things: the push relay, and the media endpoints that store and
 * return encrypted blobs. Both are public knowledge — the media it holds is
 * unreadable without the message keys, and the push side is guarded by a real
 * sign-in check.
 */
export const WORKER_BASE_URL = 'https://chatter2.ishantsil56.workers.dev';

/** Refuse to upload anything larger than this, to stay inside R2 and Worker limits. */
export const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

/**
 * PUSH_ENABLED gates FCM registration.
 *
 * ON, because IRIS now has a sender: the Cloudflare Worker in worker/index.js
 * polls Firestore once a minute and asks FCM to wake recipients, so pushes
 * arrive with the app closed. Without a sender this would only trigger a
 * pointless permission prompt — which is why it used to be off.
 *
 * Registering a device token is harmless if the Worker is ever switched off;
 * messages simply arrive live again, as they did before.
 */
export const PUSH_ENABLED = true;

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
