import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { palette } from '@/theme';
import { PhoneAuthScreen } from '@/screens/PhoneAuthScreen';
import { OtpScreen } from '@/screens/OtpScreen';
import { ProfileSetupScreen } from '@/screens/ProfileSetupScreen';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator({ initialRoute = 'Phone' }: { initialRoute?: keyof AuthStackParamList }): React.JSX.Element {
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
      <Stack.Screen name="Phone" component={PhoneAuthScreen} options={{ title: 'Enter your phone number' }} />
      <Stack.Screen name="Otp" component={OtpScreen} options={{ title: 'Verify your number' }} />
      <Stack.Screen
        name="ProfileSetup"
        component={ProfileSetupScreen}
        options={{ title: 'Profile info', headerBackVisible: false }}
      />
    </Stack.Navigator>
  );
}
