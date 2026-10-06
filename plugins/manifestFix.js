/**
 * The manifest transformation itself, kept free of Expo imports so it can be
 * unit-tested without a native build.
 *
 * expo-notifications and @react-native-firebase/messaging both declare the same
 * FCM notification meta-data with different values, which makes Gradle's
 * manifest merger fail. IRIS's values should win, so the entries we declare are
 * marked authoritative with `tools:replace` — exactly what the merger suggests:
 *
 *   Suggestion: add 'tools:replace="android:value"' to <meta-data> element …
 */

const META_DATA = [
  'com.google.firebase.messaging.default_notification_channel_id',
  'com.google.firebase.messaging.default_notification_color',
  'com.google.firebase.messaging.default_notification_icon',
];

const TOOLS_NS = 'http://schemas.android.com/tools';

/**
 * Mutates an AndroidManifest object (as produced by @expo/config-plugins) and
 * returns it. Only entries we actually declare are touched.
 */
function applyManifestFix(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest;
  manifest.$ = manifest.$ || {};
  if (!manifest.$['xmlns:tools']) manifest.$['xmlns:tools'] = TOOLS_NS;

  const application = (manifest.application || [])[0];
  if (!application) return manifest;

  const entries = application['meta-data'] || [];
  for (const name of META_DATA) {
    const entry = entries.find((m) => m && m.$ && m.$['android:name'] === name);
    // Listing an attribute that is not present is harmless, so this covers both
    // value= and resource= shapes without having to know which is which.
    if (entry) entry.$['tools:replace'] = 'android:value,android:resource';
  }
  return manifest;
}

module.exports = { applyManifestFix, META_DATA, TOOLS_NS };
