import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@/theme';
import { useUiStore } from '@/store/uiStore';

/**
 * A floating bottom bar, in the style Telegram uses.
 *
 * The tabs sit in a rounded bar that hovers above the bottom edge, over a
 * blurred, translucent panel. The active tab is marked by a pill that *slides*
 * between positions rather than appearing in place, so switching tabs reads as
 * one continuous movement.
 *
 * Notes on the parts that are easy to get wrong:
 *
 * - Android has no real backdrop blur below API 31, and `expo-blur` degrades to
 *   a flat wash there. So the bar always paints a translucent tint *under* the
 *   blur: where blur works it adds depth, and where it doesn't the bar still
 *   looks deliberate instead of transparent.
 * - The sliding pill is driven by the plain `Animated` API with
 *   `useNativeDriver`, not Reanimated. Reanimated needs a babel plugin wired
 *   into the native build; this does not, and the animation is simple enough
 *   that the difference is invisible.
 * - Haptics are fire-and-forget and wrapped, because a device without a
 *   vibrator should never make a tab press fail.
 */

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Chats: { on: 'chatbubbles', off: 'chatbubbles-outline' },
  Contacts: { on: 'people', off: 'people-outline' },
  Settings: { on: 'settings', off: 'settings-outline' },
};

/** Minimum comfortable touch target, in dp. */
const MIN_TARGET = 48;

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const hapticsOn = useUiStore((s) => s.haptics);

  const [barWidth, setBarWidth] = useState(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const tabCount = state.routes.length;
  const itemWidth = barWidth > 0 ? barWidth / tabCount : 0;

  // Horizontal position of the active pill.
  const slide = useRef(new Animated.Value(0)).current;
  // Vertical offset used to tuck the bar away while typing.
  const hide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (itemWidth === 0) return;
    const to = state.index * itemWidth;
    if (theme.reduceMotion) {
      slide.setValue(to);
      return;
    }
    Animated.spring(slide, {
      toValue: to,
      useNativeDriver: true,
      speed: 18,
      bounciness: 6,
    }).start();
  }, [state.index, itemWidth, slide, theme.reduceMotion]);

  // Hide the bar while the keyboard is up, so it never sits on top of the
  // composer. The offset clears the bar's own height plus the safe area.
  useEffect(() => {
    const to = keyboardOpen ? 140 : 0;
    if (theme.reduceMotion) {
      hide.setValue(to);
      return;
    }
    Animated.timing(hide, {
      toValue: to,
      duration: keyboardOpen ? 180 : 220,
      easing: keyboardOpen ? Easing.in(Easing.quad) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [keyboardOpen, hide, theme.reduceMotion]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const dismiss = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      dismiss.remove();
    };
  }, []);

  const tap = (): void => {
    if (!hapticsOn) return;
    // Fire-and-forget, and swallowed: a device with no vibrator must not make a
    // tab press fail.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  };

  const { palette, radius, spacing } = theme;

  return (
    <Animated.View
      style={[styles.wrap, { bottom: Math.max(insets.bottom, spacing.md), transform: [{ translateY: hide }] }]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.bar,
          {
            borderRadius: radius.pill,
            borderColor: palette.border,
          },
        ]}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width - spacing.xs * 2)}
      >
        {/* The blurred, translucent panel. Painted first so everything else sits on it. */}
        <BlurView
          intensity={Platform.OS === 'android' ? 40 : 60}
          tint="dark"
          // Real backdrop blur on Android needs API 31+; below that this is a wash.
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        />
        <View
          style={[
            StyleSheet.absoluteFill,
            { borderRadius: radius.pill, backgroundColor: palette.background },
          ]}
          pointerEvents="none"
        />

        {/* The sliding pill. Sits behind the tabs, moves as one piece. */}
        {itemWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.pill,
              {
                width: itemWidth,
                borderRadius: radius.md,
                backgroundColor: palette.accentSoft,
                borderColor: palette.accent,
                transform: [{ translateX: Animated.add(slide, spacing.xs) }],
              },
            ]}
          />
        ) : null}

        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const icon = ICONS[route.name] ?? { on: 'ellipse', off: 'ellipse-outline' };

          const onPress = (): void => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              tap();
              navigation.navigate(route.name);
            }
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={styles.item}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
              // Without this the pill's edges swallow taps aimed at a neighbour.
              android_ripple={{ color: palette.accentSoft, borderless: true, radius: 28 }}
            >
              <Ionicons
                name={focused ? icon.on : icon.off}
                size={22}
                color={focused ? palette.accent : palette.textMuted}
              />
              <Text style={[styles.label, focused ? { color: palette.accent, fontWeight: '600' } : null]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // box-none so the empty space either side of the bar still passes taps through.
  wrap: { position: 'absolute', left: 16, right: 16 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 4,
    paddingHorizontal: 4,
    overflow: 'hidden',
    // A soft lift, so it reads as floating above the content.
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  pill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    borderWidth: 1,
    opacity: 0.9,
  },
  item: {
    flex: 1,
    minHeight: MIN_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: 6,
  },
  label: { fontSize: 11 },
});
