import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme, type Theme, palette } from '@/theme';
import { useUiStore } from '@/store/uiStore';
import { useChatBadgeStore } from '@/store/chatBadgeStore';

/**
 * A floating bottom bar, in the style Telegram uses.
 *
 * The tabs sit in a rounded bar that hovers above the bottom edge. The bar
 * itself is clear — no blur, no tint — so the artwork behind it shows
 * through sharply; the plate reads as glass from its light border, its top
 * sheen and its drop shadow. The active tab is marked by a tinted pill that
 * *pops* into place — it scales up and rises as it fades in — rather than
 * sliding between positions. A pop reads as a button being pressed, which is
 * what a tab switch is; a slide reads as a separate object travelling around
 * the bar, which is not.
 *
 * Notes on the parts that are easy to get wrong:
 *
 * - The bar paints nothing behind the tabs: no blur, no tint wash. An
 *   earlier version blurred the backdrop (and before that painted its own
 *   artwork), which is why "transparent" kept reading as frosted. Clear
 *   means clear; the plate is only its border, sheen and shadow.
 * - Each tab owns its own animation value. That is what makes the pop possible
 *   at all: there is no shared position to travel from, so the old tab's pill
 *   simply fades out where it is while the new one pops in where it belongs.
 * - Everything is plain `Animated` with `useNativeDriver`, not Reanimated.
 *   Reanimated needs a babel plugin wired into the native build; this does not.
 * - Haptics are fire-and-forget and swallowed, because a device without a
 *   vibrator should never make a tab press fail.
 */

/**
 * The tab artwork — the original IRIS marks, not a redrawing of them.
 *
 * These were hand-approximated as SVG paths once, and the result looked like
 * what it was: someone tracing a picture. So the source artwork is used as-is.
 *
 * Each PNG carries the shape in its ALPHA channel (luminance, with the backdrop
 * level subtracted), which is what lets `tintColor` recolour it cleanly — the
 * active and inactive states are one image in two colours, and none of the
 * original curves or glow are lost.
 */
const ICONS: Record<string, number> = {
  Chats: require('../../assets/icons/chat.png'),
  Contacts: require('../../assets/icons/contacts.png'),
  Settings: require('../../assets/icons/settings.png'),
};

/**
 * Icon size.
 *
 * The IRIS emblems are thin line art — the ring and needle only cover a few
 * percent of their tile — so they need real room to read. A stock 24-30dp slot
 * renders them hair-thin, which is why they looked invisible.
 */
const ICON_SIZE = 38;
/** Corner radius of the glossy active pill. Chosen to match the mockup: rounder
 *  than a card, not a full capsule, so it reads as a raised key. */
const PILL_RADIUS = 22;

interface TabItemProps {
  focused: boolean;
  label: string;
  icon: number | undefined;
  theme: Theme;
  /** Unread chats, shown as a count on the Chats tab. 0 hides the badge. */
  badge?: number;
  /** True when one of those unread chats mentions you — swaps the count for a #. */
  mention?: boolean;
  onPress: () => void;
}

/**
 * One tab. Split into its own component so it can hold the animation value that
 * drives its pop — hooks cannot live inside the parent's `.map`.
 */
function TabItem({ focused, label, icon, theme, badge = 0, mention = false, onPress }: TabItemProps): React.JSX.Element {
  const { reduceMotion } = theme;
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
            borderRadius: PILL_RADIUS,
            opacity: pop,
            transform: [{ scale: pillScale }, { translateY: pillLift }],
          },
        ]}
      >
        {/*
          The body of the pill: a three-stop gradient from the light accent at
          the top edge down to the dark one, run diagonally so the light corner
          reads as a light source. This is the "3D" part — a flat fill has no
          direction, so it cannot look raised.
        */}
        <LinearGradient
          colors={[palette.accentAlt, palette.accent, palette.accentDark]}
          locations={[0, 0.55, 1]}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[StyleSheet.absoluteFill, { borderRadius: PILL_RADIUS }]}
        />
        {/*
          The gloss. A soft white sheen strongest at the top, gone by halfway:
          what makes the surface read as wet rather than matte. Without this the
          gradient alone looks like a coloured sticker.
        */}
        <LinearGradient
          colors={['rgba(255,255,255,0.40)', 'rgba(255,255,255,0.08)', 'transparent']}
          locations={[0, 0.45, 1]}
          style={[StyleSheet.absoluteFill, { borderRadius: PILL_RADIUS }]}
        />
      </Animated.View>

      <Animated.View style={{ transform: [{ scale: iconScale }] }}>
        {icon ? (
          <Image
            source={icon}
            style={{ width: ICON_SIZE, height: ICON_SIZE }}
            resizeMode="contain"
            // The alpha carries the shape, so a tint recolours it exactly.
            // Near-white on the glossy pill. Accent-on-accent used to sink into
            // the gradient; this is the contrast the mockup has.
            tintColor={focused ? palette.text : palette.textMuted}
          />
        ) : (
          <View style={{ width: ICON_SIZE, height: ICON_SIZE }} />
        )}

        {/*
          The badge. A mention outranks a count: if something you were named in
          is waiting, that is the thing worth knowing, so it replaces the number
          rather than sitting beside it.
        */}
        {badge > 0 || mention ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: mention ? palette.gold : palette.accent, borderColor: palette.surface },
            ]}
            accessibilityLabel={mention ? `${badge} unread, including a mention` : `${badge} unread`}
          >
            <Text style={[styles.badgeText, { color: mention ? palette.textInverse : palette.textInverse }]}>
              {mention ? '#' : badge > 99 ? '99+' : String(badge)}
            </Text>
          </View>
        ) : null}
      </Animated.View>

      <Text
        style={[styles.label, focused ? { color: palette.text, fontWeight: '700' } : null]}
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
  const unreadChats = useChatBadgeStore((s) => s.unread);
  const mentionChats = useChatBadgeStore((s) => s.mentions > 0);

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
      <View style={[styles.bar, { borderRadius: radius.pill, borderColor: 'rgba(255,255,255,0.28)' }]}>
        {/*
          No blur, no tint wash — the bar is clear, so the artwork behind it
          shows through sharply instead of frosted. What is left of the
          "glass plate" is the plate itself: the light border, the top sheen
          and the drop shadow. The previous version kept a BlurView here,
          which is why it still looked blurred after the backdrop fix.
        */}
        {/* A sheen across the top edge: the difference between a pane of glass
            and a flat rectangle of tinted colour. Stronger at the very top
            edge now, so the plate reads as lit from above. */}
        <LinearGradient
          colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0.02)', 'transparent']}
          locations={[0, 0.35, 1]}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.pill }]}
          pointerEvents="none"
        />

        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];
          const label = options.title ?? route.name;
          const icon = ICONS[route.name];

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
              icon={icon}
              theme={theme}
              // Only the Chats tab carries a badge.
              badge={route.name === 'Chats' ? unreadChats : 0}
              mention={route.name === 'Chats' && mentionChats}
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
    paddingVertical: 6,
    paddingHorizontal: 6,
    overflow: 'hidden',
    // A soft lift, so it reads as floating above the content. Deeper than
    // before: a glass plate needs a shadow with weight to sell the depth.
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  pill: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 4,
    right: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    // The glow is what lifts the pill off the bar and sells the depth. Accent
    // coloured, so it follows the chosen accent rather than being fixed violet.
    shadowColor: palette.accent,
    shadowOpacity: 0.65,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
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
  // Sits on the icon's top-right, like a stock tab badge.
  badge: {
    position: 'absolute',
    top: 0,
    right: 6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 10, fontWeight: '700', lineHeight: 14 },
});
