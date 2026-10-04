import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, radius } from '@/theme';

export interface ErrorBannerProps {
  /** Already-friendly text (use friendlyError() from @/utils/errors). Renders nothing when empty. */
  message: string | null | undefined;
  onRetry?: () => void;
  retryLabel?: string;
  onDismiss?: () => void;
}

/**
 * The one reusable error surface: a short friendly message with optional Retry
 * and Dismiss. Announced to screen readers as an alert.
 */
export function ErrorBanner({ message, onRetry, retryLabel = 'Retry', onDismiss }: ErrorBannerProps): React.JSX.Element | null {
  if (!message) return null;
  return (
    <View style={styles.wrap} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="error-banner">
      <Ionicons name="alert-circle-outline" size={18} color={palette.danger} accessible={false} />
      <Text style={styles.text}>{message}</Text>
      {onRetry ? (
        <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel={retryLabel} hitSlop={8}>
          <Text style={styles.action}>{retryLabel}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss error" hitSlop={8}>
          <Ionicons name="close" size={18} color={palette.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: palette.surfaceAlt,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginVertical: spacing.sm,
  },
  text: { flex: 1, color: palette.text, fontSize: fontSize.sm, lineHeight: 18 },
  action: { color: palette.accent, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
