import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface CardProps {
  children: React.ReactNode;
  /** Slightly lifted surface, for grouped rows in Settings. */
  raised?: boolean;
  padded?: boolean;
  style?: ViewStyle;
}

/** A grouped surface. One radius, one border, one shadow — used everywhere. */
export function Card({ children, raised = false, padded = true, style }: CardProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: raised ? theme.palette.surfaceAlt : theme.palette.surface,
          borderRadius: theme.radius.lg,
          borderColor: theme.palette.borderSoft,
          padding: padded ? theme.spacing.lg : 0,
        },
        theme.shadows.soft,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
});
