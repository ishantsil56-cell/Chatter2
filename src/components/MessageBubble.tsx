import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palette, spacing, fontSize, fontWeight, bubbleRadius, radius } from '@/theme';
import { formatMessageTime } from '@/utils/time';
import { DeliveryTicks } from './DeliveryTicks';
import { MediaContent } from './MediaContent';
import { parseMediaBody } from '@/services/storage';
import type { DecryptedMessage, MessageStatus } from '@/types';

export interface MessageBubbleProps {
  message: DecryptedMessage;
  isMine: boolean;
  showTail?: boolean;
  senderName?: string;
  onLongPress?: (message: DecryptedMessage) => void;
}

export function MessageBubble({ message, isMine, showTail = true, senderName, onLongPress }: MessageBubbleProps): React.JSX.Element {
  if (message.kind === 'system') {
    return (
      <View style={styles.systemWrap}>
        <Text style={styles.systemText}>{message.systemText}</Text>
      </View>
    );
  }

  const undecryptable = !message.decrypted && !isMine;
  const mediaBody = parseMediaBody(message.text);
  const caption = mediaBody?.caption ?? '';
  const textToShow = mediaBody ? caption : message.text;

  // One of our own messages whose plaintext isn't on this device (e.g. after a
  // reinstall, since the local plaintext cache is wiped). Show a note instead
  // of an empty bubble.
  const mineUnavailable = isMine && !message.media && !textToShow;
  const unavailable = undecryptable || mineUnavailable;

  // The tick must reflect the RECIPIENTS, not us. Reading our own receipt (which
  // is always 'sent') is why the tick never moved past one checkmark.
  const recipients = Object.keys(message.receipts ?? {}).filter((u) => u !== message.senderId);
  const status: MessageStatus =
    recipients.length > 0 && recipients.every((u) => message.receipts[u] === 'read')
      ? 'read'
      : recipients.length > 0 &&
          recipients.every((u) => message.receipts[u] === 'read' || message.receipts[u] === 'delivered')
        ? 'delivered'
        : 'sent';

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        onLongPress={() => onLongPress?.(message)}
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
          showTail ? (isMine ? bubbleRadius.mine : bubbleRadius.theirs) : null,
        ]}
      >
        {senderName && !isMine ? <Text style={styles.senderName}>{senderName}</Text> : null}

        {unavailable ? (
          <Text style={styles.pending}>
            {isMine ? 'Not stored on this device' : 'Waiting for this message…'}
          </Text>
        ) : (
          <>
            {message.media ? <MediaContent message={message} isMine={isMine} /> : null}
            {textToShow ? <Text style={styles.text}>{textToShow}</Text> : null}
          </>
        )}

        <View style={styles.footer}>
          <Text style={styles.time}>{formatMessageTime(message.createdAt)}</Text>
          {isMine ? <DeliveryTicks status={status} /> : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 1, paddingHorizontal: spacing.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: palette.bubbleOut },
  bubbleTheirs: { backgroundColor: palette.bubbleIn },
  senderName: { color: palette.tick, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: 2 },
  text: { color: palette.text, fontSize: fontSize.md, lineHeight: 20 },
  pending: { color: palette.textMuted, fontSize: fontSize.sm, fontStyle: 'italic' },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2 },
  time: { color: palette.textMuted, fontSize: fontSize.xs },
  systemWrap: { alignItems: 'center', marginVertical: spacing.sm, paddingHorizontal: spacing.xl },
  systemText: {
    color: palette.textMuted,
    fontSize: fontSize.xs,
    backgroundColor: palette.bubbleSystem,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
