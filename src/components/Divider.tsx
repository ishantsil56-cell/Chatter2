import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export interface DividerProps {
  /** Left inset, for lists where rows start after an avatar. */
  inset?: number;
  style?: ViewStyle;
}

export function Divider({ inset = 0, style }: DividerProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.line,
        { backgroundColor: theme.palette.borderSoft, marginLeft: inset },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({ line: { height: StyleSheet.hairlineWidth } });
