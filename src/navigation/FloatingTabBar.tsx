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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme, type Theme, palette } from '@/theme';
import { useUiStore } from '@/store/uiStore';
import {
  ChatIcon,
  ContactsIcon,
  SettingsIcon,
  type IrisIconProps,
} from '@/components/icons/IrisIcons';

/**
 * A floating bottom bar, in the style Telegram uses.
 *
 * The tabs sit in a rounded bar that hovers above the bottom edge, over a
 * blurred, translucent panel. The active tab is marked by a tinted pill that
 * *pops* into place — it scales up and rises as it fades in — rather than
 * sliding between positions. A pop reads as a button being pressed, which is
 * what a tab switch is; a slide reads as a separate object travelling around
 * the bar, which is not.
 *
 * Notes on the parts that are easy to get wrong:
 *
 * - Android has no real backdrop blur below API 31, and `expo-blur` degrades to
 *   a flat wash there. So the bar always paints a translucent tint *under* the
 *   blur: where blur works it adds depth, and where it doesn't the bar still
 *   looks deliberate instead of transparent.
 * - Each tab owns its own animation value. That is what makes the pop possible
 *   at all: there is no shared position to travel from, so the old tab's pill
 *   simply fades out where it is while the new one pops in where it belongs.
 * - Everything is plain `Animated` with `useNativeDriver`, not Reanimated.
 *   Reanimated needs a babel plugin wired into the native build; this does not.
 * - Haptics are fire-and-forget and swallowed, because a device without a
 *   vibrator should never make a tab press fail.
 */

/**
 * The tab artwork, one vector per tab.
 *
 * These are drawn as paths rather than loaded as images. A bitmap has one
 * correct size and everything else is a resample; these are exact at any size,
 * share a 24x24 grid so they line up with each other, and take a `color` — so
 * the active/inactive difference is a tint rather than a second image or an
 * opacity fudge.
 */
const ICONS: Record<string, React.ComponentType<IrisIconProps>> = {
  Chats: ChatIcon,
  Contacts: ContactsIcon,
  Settings: SettingsIcon,
};

/**
 * Icon size.
 *
 * The IRIS emblems are thin line art — the ring and needle only cover a few
 * percent of their tile — so they need real room to read. A stock 24-30dp slot
 * renders them hair-thin, which is why they looked invisible.
 */
const ICON_SIZE = 38;

interface TabItemProps {
  focused: boolean;
  label: string;
  icon: React.ComponentType<IrisIconProps> | undefined;
  theme: Theme;
  onPress: () => void;
}

/**
 * One tab. Split into its own component so it can hold the animation value that
 * drives its pop — hooks cannot live inside the parent's `.map`.
 */
function TabItem({ focused, label, icon: Icon, theme, onPress }: TabItemProps): React.JSX.Element {
  const { radius, reduceMotion } = theme;
  const pop = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pop.setValue(focused ? 1 : 0);
      return;
    }
    Animated.spring(pop, {
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 10,
    }).start();
  }, [focused, reduceMotion, pop]);

  // The pill grows into place and lifts slightly as it appears.
  const pillScale = pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const pillLift = pop.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });
  // The icon leans into the press very slightly.
  const iconScale = pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      android_ripple={{ color: palette.accentSoft, borderless: true, radius: 30 }}
    >
      {/* The pop. Absolute, so it sits behind the icon without affecting layout. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.pill,
          {
            borderRadius: radius.md,
            backgroundColor: palette.accentSoft,
            borderColor: palette.accent,
            opacity: pop,
            transform: [{ scale: pillScale }, { translateY: pillLift }],
          },
        ]}
      />

      <Animated.View style={{ transform: [{ scale: iconScale }] }}>
        {Icon ? (
          <Icon
            size={ICON_SIZE}
            // Tint, not opacity: the inactive tabs are a dimmer shade of the
            // same colour rather than a faded copy, which keeps the strokes
            // crisp instead of washing them out.
            color={focused ? palette.accent : palette.textMuted}
          />
        ) : (
          <View style={{ width: ICON_SIZE, height: ICON_SIZE }} />
        )}
      </Animated.View>

      <Text
        style={[styles.label, focused ? { color: palette.accent, fontWeight: '600' } : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const hapticsOn = useUiStore((s) => s.haptics);

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const hide = useRef(new Animated.Value(0)).current;

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
      style={[styles.wrap, { bottom: Math.max(insets.bottom, spacing.sm), transform: [{ translateY: hide }] }]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, { borderRadius: radius.pill, borderColor: palette.border }]}>
        {/* The blurred, translucent panel. Painted first so everything else sits on it. */}
        <BlurView
          intensity={Platform.OS === 'android' ? 40 : 60}
          tint="dark"
          // Real backdrop blur on Android needs API 31+; below that this is a wash.
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
        />
        <View
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill, backgroundColor: palette.background }]}
          pointerEvents="none"
        />

        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const Icon = ICONS[route.name];

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
            <TabItem
              key={route.key}
              focused={focused}
              label={label}
              icon={Icon}
              theme={theme}
              onPress={onPress}
            />
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
    paddingVertical: 2,
    paddingHorizontal: 4,
    overflow: 'hidden',
    // A soft lift, so it reads as floating above the content.
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  // The pill fills its own tab, so no width measurement is needed.
  pill: { position: 'absolute', top: 2, bottom: 2, left: 4, right: 4, borderWidth: 1 },
  item: {
    flex: 1,
    // Grown from 44 to fit the larger artwork. Still shorter than the original
    // bar, but the icons have to be readable first.
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingVertical: 3,
  },
  label: { fontSize: 10, letterSpacing: 0.2 },
});
