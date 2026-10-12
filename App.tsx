import React, { useEffect, useMemo } from 'react';
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
import { useFonts } from 'expo-font';
import { Cinzel_400Regular, Cinzel_600SemiBold, Cinzel_700Bold } from '@expo-google-fonts/cinzel';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { RootNavigator } from './src/navigation/RootNavigator';
import { DialogProvider } from './src/components/AppDialog';
import { BlinkingLogo } from './src/components/BlinkingLogo';
import { chatIdFromResponse } from './src/services/notifications';
import type { AppStackParamList } from './src/navigation/types';
import { useAppBootstrap } from './src/hooks/useAppBootstrap';
import { useDiagStore } from './src/store/diagStore';
import { ThemeProvider, useTheme } from './src/theme';

/** Lets a tapped notification navigate, since that happens outside the React tree. */
const navigationRef = createNavigationContainerRef<AppStackParamList>();

export default function App(): React.JSX.Element {
  // Cinzel for headings, Inter for everything else. If a font fails to load we
  // carry on with the system font rather than holding the splash forever.
  const [fontsLoaded, fontError] = useFonts({
    Cinzel_400Regular,
    Cinzel_600SemiBold,
    Cinzel_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const ready = fontsLoaded || !!fontError;

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
          <ThemeProvider>{ready ? <AppShell /> : <Splash />}</ThemeProvider>
        </SafeAreaProvider>
      </ImageBackground>
    </GestureHandlerRootView>
  );
}

/** Shown while fonts load — the IRIS mark, blinking. */
function Splash(): React.JSX.Element {
  return (
    <View style={styles.splash}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <BlinkingLogo size={120} />
    </View>
  );
}

function AppShell(): React.JSX.Element {
  const theme = useTheme();
  useAppBootstrap();
  const lastError = useDiagStore((s) => s.lastError);
  const setError = useDiagStore((s) => s.setError);

  // Built from the live theme, so a change of accent reaches the navigator too.
  const navTheme = useMemo<NavTheme>(
    () => ({
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: theme.palette.accent,
        // Transparent so the app-wide artwork behind the navigator shows through.
        background: 'transparent',
        card: theme.palette.surface,
        text: theme.palette.text,
        border: theme.palette.border,
        notification: theme.palette.accent,
      },
    }),
    [theme.palette],
  );

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

  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={theme.palette.backgroundSolid} />
      {lastError ? (
        <View style={[styles.errorWrap, { backgroundColor: theme.palette.background, padding: theme.spacing.xl }]}>
          <Text
            style={[
              theme.type.subtitle,
              { color: theme.palette.danger, marginBottom: theme.spacing.sm },
            ]}
          >
            Something went wrong
          </Text>
          <Text
            style={[
              theme.type.caption,
              { color: theme.palette.textMuted, marginBottom: theme.spacing.lg },
            ]}
          >
            Please screenshot this and send it — it tells us exactly what failed.
          </Text>
          <ScrollView
            style={[
              styles.errorScroll,
              { backgroundColor: theme.palette.surfaceAlt, borderRadius: theme.radius.md, padding: theme.spacing.md },
            ]}
          >
            <Text style={[theme.type.caption, { color: theme.palette.text }]}>{lastError}</Text>
          </ScrollView>
          <Pressable
            style={[
              styles.errorButton,
              {
                backgroundColor: theme.palette.accent,
                borderRadius: theme.radius.md,
                paddingVertical: theme.spacing.md,
                marginTop: theme.spacing.xl,
              },
            ]}
            onPress={() => setError(null)}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={[theme.type.bodyStrong, { color: theme.palette.textInverse }]}>Dismiss</Text>
          </Pressable>
        </View>
      ) : (
        <DialogProvider>
          <NavigationContainer theme={navTheme} ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        </DialogProvider>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorWrap: { flex: 1, justifyContent: 'center' },
  errorScroll: { maxHeight: 300 },
  errorButton: { alignItems: 'center' },
});
