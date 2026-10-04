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
        <ActivityIndicator size="large" color={palette.accent} />
      </View>
    );
  }

  // `needsProfile` is part of the auth stack (after sign-in, before the app).
  // The `key` matters: React Navigation only honours `initialRouteName` when a
  // navigator mounts, so keying by status forces a remount when we move from
  // sign-in to the profile step. Without it the navigator stays stuck on the
  // sign-in screen and the user just sees a blank page.
  if (status === 'ready') return <AppNavigator />;
  return (
    <AuthNavigator
      key={status}
      initialRoute={status === 'needsProfile' ? 'ProfileSetup' : 'SignIn'}
    />
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background },
});
