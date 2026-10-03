import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { palette } from '@/theme';
import { SignInScreen } from '@/screens/SignInScreen';
import { ProfileSetupScreen } from '@/screens/ProfileSetupScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator({
  initialRoute = 'SignIn',
}: {
  initialRoute?: keyof AuthStackParamList;
}): React.JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.text,
        headerTitleStyle: { color: palette.text },
        contentStyle: { backgroundColor: palette.background },
      }}
    >
      <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{ title: 'Profile info', headerBackVisible: false }}
      />
    </Stack.Navigator>
  );
}
