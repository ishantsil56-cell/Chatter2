import React from 'react';
import { StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette } from '@/theme';
import type { MessageStatus } from '@/types';

export function statusLabel(status: MessageStatus): string {
  switch (status) {
    case 'failed':
      return 'Not sent';
    case 'sending':
      return 'Sending';
    case 'sent':
      return 'Sent';
    case 'delivered':
      return 'Delivered';
    case 'read':
      return 'Read';
  }
}

/** The little sending/sent/delivered/read ticks beside an outgoing message. */
export function DeliveryTicks({ status, size = 15 }: { status: MessageStatus; size?: number }): React.JSX.Element {
  const label = statusLabel(status);
  const common = { size, style: styles.icon, accessibilityLabel: label, accessibilityRole: 'image' as const };
  if (status === 'failed') return <Ionicons name="alert-circle" color={palette.danger} {...common} />;
  if (status === 'sending') return <Ionicons name="time-outline" color={palette.textMuted} {...common} />;
  if (status === 'sent') return <Ionicons name="checkmark" color={palette.textMuted} {...common} />;
  return <Ionicons name="checkmark-done" color={status === 'read' ? palette.tick : palette.textMuted} {...common} />;
}

const styles = StyleSheet.create({
  icon: { marginLeft: 4 },
});
