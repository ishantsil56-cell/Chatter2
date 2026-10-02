import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette } from '@/theme';
import type { MessageStatus } from '@/types';

/** The little sent/delivered/read ticks beside an outgoing message. */
export function DeliveryTicks({ status, size = 15 }: { status: MessageStatus; size?: number }): React.JSX.Element {
  if (status === 'failed') {
    return <Ionicons name="alert-circle" size={size} color={palette.danger} style={styles.icon} />;
  }
  if (status === 'sending') {
    return <Ionicons name="time-outline" size={size} color={palette.textMuted} style={styles.icon} />;
  }
  if (status === 'sent') {
    return <Ionicons name="checkmark" size={size} color={palette.textMuted} style={styles.icon} />;
  }
  return (
    <Ionicons
      name="checkmark-done"
      size={size}
      color={status === 'read' ? palette.tick : palette.textMuted}
      style={styles.icon}
    />
  );
}

const styles = StyleSheet.create({
  icon: { marginLeft: 4 },
});
