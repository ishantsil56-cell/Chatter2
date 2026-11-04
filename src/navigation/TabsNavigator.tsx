import React from 'react';
import { Image, Pressable, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { fonts, palette } from '@/theme';
import { ChatsListScreen } from '@/screens/ChatsListScreen';
import { ContactsScreen } from '@/screens/ContactsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { useLockStore } from '@/store/lockStore';
import { FloatingTabBar } from './FloatingTabBar';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

/**
 * The header title for the Chats tab: the IRIS mark, then the wordmark.
 *
 * The logo is the same asset the splash screen uses, so the app's identity is
 * consistent from launch through to the chat list. It is nudged down a hair so
 * the mark and the serif wordmark sit on a shared baseline — the two have very
 * different visual weights and centring them naively looks off.
 */
function HeaderTitle(): React.JSX.Element {
  const panicNow = useLockStore((s) => s.panicNow);
  return (
    /*
      The mark is also the panic button.

      A long press hides everything at once — no dialog, no confirmation, because
      the situation this exists for is someone leaning over your shoulder and a
      confirmation prompt would defeat the point. A press rather than a tap, so
      scrolling near the top of the list cannot trigger it by accident. It reads
      as decoration, which is exactly what makes it useful.
    */
    <Pressable
      onLongPress={panicNow}
      delayLongPress={600}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Hide IRIS"
      style={styles.titleRow}
    >
      <Image source={require('../../assets/icon.png')} style={styles.titleLogo} resizeMode="contain" />
      <Text style={styles.titleText}>IRIS</Text>
    </Pressable>
  );
}

export function TabsNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        sceneContainerStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tab.Screen
        name="Chats"
        component={ChatsListScreen}
        options={{
          title: 'IRIS',
          headerTitle: () => <HeaderTitle />,
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Contacts"
        component={ContactsScreen}
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleLogo: { width: 30, height: 30, borderRadius: 8 },
  titleText: {
    color: palette.text,
    fontFamily: fonts.display,
    fontSize: 20,
    letterSpacing: 1.5,
    // Compensates for the serif's high x-height against the square mark.
    marginTop: 1,
  },
});
