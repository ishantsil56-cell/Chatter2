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
 * MUST be listed AFTER "expo-notifications" in app.json, so the entries it
 * writes are already present when this runs.
 */
module.exports = function withNotificationManifestFix(config) {
  return withAndroidManifest(config, (cfg) => {
    applyManifestFix(cfg.modResults.manifest);
    return cfg;
  });
};
