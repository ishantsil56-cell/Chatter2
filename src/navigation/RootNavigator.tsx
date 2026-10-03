import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/store/authStore';
import { palette } from '@/theme';
import { AuthNavigator } from './AuthNavigator';
import { AppNavigator } from './AppNavigator';

/** Chooses the navigator based on auth status. */
export function RootNavigator(): React.JSX.Element {
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={palette.green} />
      </View>
    );
  }

  // `needsProfile` is part of the auth stack (after OTP, before the app).
  if (status === 'ready') return <AppNavigator />;
  return <AuthNavigator initialRoute={status === 'needsProfile' ? 'ProfileSetup' : 'SignIn'} />;
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
});
