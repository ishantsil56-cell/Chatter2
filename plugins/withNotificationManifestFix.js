const { withAndroidManifest } = require('@expo/config-plugins');
const { applyManifestFix } = require('./manifestFix');

/**
 * Resolve a manifest-merger conflict between expo-notifications and
 * @react-native-firebase/messaging.
 *
 * Both libraries declare the same FCM notification meta-data with different
 * values, so Gradle refuses to build:
 *
 *   meta-data#com.google.firebase.messaging.default_notification_channel_id
 *     value=(messages)  vs  value=()          from react-native-firebase_messaging
 *   meta-data#com.google.firebase.messaging.default_notification_color
 *     value=(@color/notification_icon_color)  vs  value=(@color/white)
 *
 * IRIS's values are the ones that make a notification look like IRIS, so they
 * are marked authoritative with `tools:replace`.
 *
 * MUST be listed FIRST in app.json's "plugins" array. Expo's mod chain runs the
 * LAST registered plugin FIRST, so being listed first is precisely what makes
 * this run *after* expo-notifications has written the entries it needs to mark.
 * (Listed last, as it first was, it ran too early, found nothing, and the
 * conflict came straight back.)
 */
module.exports = function withNotificationManifestFix(config) {
  return withAndroidManifest(config, (cfg) => {
    applyManifestFix(cfg.modResults.manifest);
    return cfg;
  });
};
