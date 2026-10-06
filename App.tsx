import React, { useEffect } from 'react';
import {
  ImageBackground,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { NavigationContainer, DarkTheme, createNavigationContainerRef, type Theme as NavTheme } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RootNavigator } from './src/navigation/RootNavigator';
import { DialogProvider } from './src/components/AppDialog';
import { chatIdFromResponse } from './src/services/notifications';
import type { AppStackParamList } from './src/navigation/types';
import { useAppBootstrap } from './src/hooks/useAppBootstrap';
import { useDiagStore } from './src/store/diagStore';
import { palette, spacing, fontSize, radius, fontWeight } from './src/theme';

const navTheme: NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.accent,
    // Transparent so the app-wide artwork behind the navigator shows through.
    // Screens themselves use a slightly translucent `palette.background`.
    background: 'transparent',
    card: palette.surface,
    text: palette.text,
    border: palette.border,
    notification: palette.accent,
  },
};

/** Lets a tapped notification navigate, since that happens outside the React tree. */
const navigationRef = createNavigationContainerRef<AppStackParamList>();

export default function App(): React.JSX.Element {
  useAppBootstrap();
  const lastError = useDiagStore((s) => s.lastError);
  const setError = useDiagStore((s) => s.setError);

  // Tapping a message notification should land in that chat.
  useEffect(() => {
    const openFromNotification = (response: Notifications.NotificationResponse | null): void => {
      const chatId = chatIdFromResponse(response);
      if (chatId && navigationRef.isReady()) navigationRef.navigate('Chat', { chatId });
    };
    void Notifications.getLastNotificationResponseAsync().then(openFromNotification);
    const sub = Notifications.addNotificationResponseReceivedListener(openFromNotification);
    return () => sub.remove();
  }, []);

  // Catch any uncaught JS error and show it on screen. We can't read device
  // logs, so this is how we find out what actually went wrong.
  useEffect(() => {
    const errorUtils = (
      globalThis as unknown as {
        ErrorUtils?: { setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void };
      }
    ).ErrorUtils;
    errorUtils?.setGlobalHandler?.((error, isFatal) => {
      const message = error instanceof Error ? error.message : String(error);
      useDiagStore.getState().setError(`${isFatal ? 'Fatal error: ' : 'Error: '}${message}`);
    });
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      {/* One artwork behind the entire app; every screen sits on top of it. */}
      <ImageBackground
        source={require('./assets/app-background.jpg')}
        style={styles.root}
        resizeMode="cover"
      >
        <SafeAreaProvider>
          <StatusBar barStyle="light-content" backgroundColor={palette.backgroundSolid} />
          {lastError ? (
            <View style={styles.errorWrap}>
              <Text style={styles.errorTitle}>Something went wrong</Text>
              <Text style={styles.errorHint}>
                Please screenshot this and send it — it tells us exactly what failed.
              </Text>
              <ScrollView style={styles.errorScroll}>
                <Text style={styles.errorText}>{lastError}</Text>
              </ScrollView>
              <Pressable style={styles.errorButton} onPress={() => setError(null)}>
                <Text style={styles.errorButtonText}>Dismiss</Text>
              </Pressable>
            </View>
          ) : (
            <DialogProvider>
              <NavigationContainer theme={navTheme} ref={navigationRef}>
                <RootNavigator />
              </NavigationContainer>
            </DialogProvider>
          )}
        </SafeAreaProvider>
      </ImageBackground>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  errorWrap: { flex: 1, backgroundColor: palette.background, padding: spacing.xl, justifyContent: 'center' },
  errorTitle: { color: palette.danger, fontSize: fontSize.xl, fontWeight: fontWeight.bold, marginBottom: spacing.sm },
  errorHint: { color: palette.textMuted, fontSize: fontSize.sm, marginBottom: spacing.lg, lineHeight: 18 },
  errorScroll: { maxHeight: 300, backgroundColor: palette.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  errorText: { color: palette.text, fontSize: fontSize.sm, lineHeight: 19 },
  errorButton: {
    backgroundColor: palette.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  errorButtonText: { color: palette.textInverse, fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
});
