import React, { useEffect } from 'react';
import { AppState, Image, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, spacing, fontSize } from '@/theme';
import { useLockStore } from '@/store/lockStore';

/**
 * Covers the app when it goes to the background, so the task-switcher thumbnail
 * shows no conversation.
 *
 * Two layers on purpose. The blur gives the effect in the designs; the dark wash
 * over it is the guarantee. Android captures the thumbnail at the moment of
 * backgrounding, so if the blur has not composited yet the user still sees
 * darkness rather than their messages.
 *
 * Note what this is not: it is not a screenshot of the app blurred. Capturing
 * one would need another dependency, so the blur is of the live view behind it,
 * which is why it only works while the app is still rendered.
 */
export function PrivacyCover(): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const visible = useLockStore((s) => s.coverVisible);
  const status = useLockStore((s) => s.status);
  const blurEnabled = useLockStore((s) => s.prefs.blurCover);
  const noteBackground = useLockStore((s) => s.noteBackground);
  const noteForeground = useLockStore((s) => s.noteForeground);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') noteBackground();
      // Android only reports 'active' and 'background'; 'inactive' is iOS, and
      // treating it as a trip to the background would lock on every system
      // dialog.
      else if (next === 'active') noteForeground();
    });
    return () => sub.remove();
  }, [noteBackground, noteForeground]);

  // When the gate is up, the lock screen is already covering everything.
  if (!visible || status !== 'unlocked') return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {blurEnabled ? (
        <BlurView
          intensity={60}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <View style={[StyleSheet.absoluteFill, styles.wash]} />
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Image source={require('../../assets/iris-eye.png')} style={styles.eye} resizeMode="contain" />
        <Text style={styles.wordmark}>IRIS</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Heavy enough that a compositing miss still hides detail, light enough that
  // the blur underneath is what the eye actually reads.
  wash: { backgroundColor: 'rgba(8,11,20,0.86)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  eye: { width: 96, height: 96, opacity: 0.9 },
  wordmark: {
    color: palette.text,
    fontSize: fontSize.xl,
    fontFamily: 'Cinzel_600SemiBold',
    letterSpacing: 6,
  },
});
