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
import { StoryViewerScreen } from '@/screens/StoryViewerScreen';
import { StoryComposerScreen } from '@/screens/StoryComposerScreen';
import { PollCreateScreen } from '@/screens/PollCreateScreen';
import { CallHost } from '@/screens/CallHost';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

export function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={{ title: '' }} />
      <Stack.Screen name="NewChat" component={NewChatScreen} options={{ title: 'New chat' }} />
      <Stack.Screen name="GroupCreate" component={GroupCreateScreen} options={{ title: 'New group' }} />
      <Stack.Screen name="GroupInfo" component={GroupInfoScreen} options={{ title: 'Group info' }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="StoryViewer" component={StoryViewerScreen} options={{ headerShown: false }} />
      <Stack.Screen name="StoryComposer" component={StoryComposerScreen} options={{ title: 'New story' }} />
      <Stack.Screen name="PollCreate" component={PollCreateScreen} options={{ title: 'Create poll' }} />
      <Stack.Screen name="Call" component={CallHost} options={{ headerShown: false, gestureEnabled: false }} />
    </Stack.Navigator>
  );
}
