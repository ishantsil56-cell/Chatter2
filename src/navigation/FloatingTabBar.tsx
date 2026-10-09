import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { palette, spacing, fontSize, fontWeight } from '@/theme';

/**
 * A floating bottom bar, in the style Telegram uses.
 *
 * Instead of a flat strip welded to the bottom edge, the tabs sit in a rounded
 * bar that hovers above it, and the active tab gets a tinted pill behind it.
 * Styled with the IRIS palette so it matches the rest of the app.
 */

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Chats: { on: 'chatbubbles', off: 'chatbubbles-outline' },
  Contacts: { on: 'people', off: 'people-outline' },
  Settings: { on: 'settings', off: 'settings-outline' },
};

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.wrap, { bottom: Math.max(insets.bottom, spacing.md) }]} pointerEvents="box-none">
      <View style={styles.bar}>
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
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Pressable
              key={route.key}
              onPress={onPress}
              style={[styles.item, focused ? styles.itemActive : null]}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              <Ionicons
                name={focused ? icon.on : icon.off}
                size={22}
                color={focused ? palette.accent : palette.textMuted}
              />
              <Text style={[styles.label, focused ? styles.labelActive : null]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // box-none so the empty space either side of the bar still passes taps through.
  wrap: { position: 'absolute', left: spacing.md, right: spacing.md },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    // A soft lift, so it reads as floating above the content.
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: 20,
  },
  itemActive: { backgroundColor: palette.accentSoft },
  label: { color: palette.textMuted, fontSize: fontSize.xs },
  labelActive: { color: palette.accent, fontWeight: fontWeight.semibold },
});
