import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { palette } from '@/theme';
import { TabsNavigator } from './TabsNavigator';
import { ChatScreen } from '@/screens/ChatScreen';
import { NewChatScreen } from '@/screens/NewChatScreen';
import { GroupCreateScreen } from '@/screens/GroupCreateScreen';
import { GroupInfoScreen } from '@/screens/GroupInfoScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { UserProfileScreen } from '@/screens/UserProfileScreen';
import { PollCreateScreen } from '@/screens/PollCreateScreen';
import { LockSetupScreen } from '@/screens/LockSetupScreen';
import { LockSettingsScreen } from '@/screens/LockSettingsScreen';
import { LedgerChatScreen } from '@/screens/LedgerChatScreen';
import { SafetyNumberScreen } from '@/screens/SafetyNumberScreen';
import { AnnouncementsScreen } from '@/screens/AnnouncementsScreen';
import { DiagnosticsScreen } from '@/screens/DiagnosticsScreen';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        contentStyle: { backgroundColor: palette.background },
        // One transition everywhere: a fast slide from the right, with a
        // full-screen swipe back. The defaults felt heavy next to the chat's
        // own loading, and a single consistent motion reads as one app
        // rather than a stack of different ones.
        animation: 'slide_from_right',
        animationDuration: 250,
        gestureEnabled: true,
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: '' }} />
      <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New chat', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="GroupCreate" component={GroupCreateScreen} options={{ title: 'New group', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: 'Group info' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="PollCreate" component={PollCreateScreen} options={{ title: 'Create poll', animation: 'slide_from_bottom' }} />
      {/* The lock screens draw their own headers, so the navigator's is off. */}
      <Stack.Screen name="LockSettings" component={LockSettingsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="LockSetup" component={LockSetupScreen} options={{ headerShown: false }} />
      {/* The Ledger's per-chat screen draws its own header, as the shelf does. */}
      <Stack.Screen name="LedgerChat" component={LedgerChatScreen} options={{ headerShown: false }} />
      <Stack.Screen name="SafetyNumber" component={SafetyNumberScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Announcements" component={AnnouncementsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
