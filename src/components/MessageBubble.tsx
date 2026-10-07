import React, { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { palette, spacing, fontSize, fontWeight, bubbleRadius, radius } from '@/theme';
import { formatMessageTime } from '@/utils/time';
import { DeliveryTicks, statusLabel } from './DeliveryTicks';
import { deliveryStatus } from '@/utils/receipts';
import { MediaContent } from './MediaContent';
import { parseMediaBody } from '@/services/storage';
import { decodeTextBody } from '@/services/messages';
import type { DecryptedMessage, MessageStatus } from '@/types';

export interface MessageBubbleProps {
  message: DecryptedMessage;
  isMine: boolean;
  /** Current chat members — receipts are judged against these, not against who was in the chat at send time. */
  memberIds?: string[];
  showTail?: boolean;
  senderName?: string;
  /** Long-press starts a selection (or extends one). */
  onLongPress?: (message: DecryptedMessage) => void;
  /** Tap while selecting toggles this message in or out. */
  onPress?: (message: DecryptedMessage) => void;
  selectMode?: boolean;
  selected?: boolean;
  /** Swiping the bubble to the right replies to it. */
  onReply?: (message: DecryptedMessage) => void;
  /** Resolve a uid to a display name, for the quoted strip. */
  nameFor?: (uid: string) => string;
  onRetrySend?: (outboxId: string) => void;
  onDiscardSend?: (outboxId: string) => void;
  onRetryDecrypt?: () => void;
}

/** What the bubble shows for a message that has no readable text. */
export function unreadableNote(message: DecryptedMessage, isMine: boolean): string {
  if (isMine) return 'Your copy isn’t available on this device';
  if (message.decryptIssue === 'conflict') return 'Setting up a secure connection…';
  return 'Can’t read this message yet';
}

export function MessageBubble({
  message,
  isMine,
  memberIds,
  showTail = true,
  senderName,
  onLongPress,
  onPress,
  selectMode = false,
  selected = false,
  onReply,
  nameFor,
  onRetrySend,
  onDiscardSend,
  onRetryDecrypt,
}: MessageBubbleProps): React.JSX.Element {
  const swipeRef = useRef<Swipeable>(null);

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
  // A text body may carry a reply alongside the text; media bodies do not.
  const body = mediaBody ? { text: caption, reply: null } : decodeTextBody(message.text);
  const textToShow = body.text;

  // One of our own messages whose plaintext isn't on this device and has no
  // history copy either. Show a note instead of an empty bubble.
  const mineUnavailable = isMine && !message.media && !textToShow;
  const unavailable = undecryptable || mineUnavailable;

  // Our own tick reflects the RECIPIENTS' receipts (current members only).
  const status: MessageStatus =
    message.sendState === 'failed'
      ? 'failed'
      : message.sendState === 'sending'
        ? 'sending'
        : deliveryStatus(message.receipts, message.senderId, memberIds ?? Object.keys(message.receipts ?? {}));

  const failed = message.sendState === 'failed' && !!message.outboxId;
  const time = formatMessageTime(message.createdAt);
  const spoken = unavailable
    ? unreadableNote(message, isMine)
    : [textToShow || (message.media ? 'Attachment' : ''), ].filter(Boolean).join('. ');
  const label = `${isMine ? 'You' : senderName ?? 'Them'}: ${spoken}. ${time}${isMine ? `. ${statusLabel(status)}` : ''}`;

  const quote = body.reply;
  const quoteName = quote ? (quote.senderId === message.senderId ? 'You' : nameFor?.(quote.senderId) ?? 'Them') : '';

  const bubble = (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      <Pressable
        onLongPress={() => onLongPress?.(message)}
        onPress={selectMode ? () => onPress?.(message) : undefined}
        // Grouped for screen readers as one sentence, unless it contains Retry/Delete buttons.
        accessible={!failed && !(undecryptable && !!onRetryDecrypt) && !selectMode}
        accessibilityLabel={label}
        accessibilityHint={selectMode ? 'Toggles this message in the selection' : 'Long-press to select'}
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
          showTail ? (isMine ? bubbleRadius.mine : bubbleRadius.theirs) : null,
          selected ? styles.bubbleSelected : null,
        ]}
      >
        {senderName && !isMine ? <Text style={styles.senderName}>{senderName}</Text> : null}

        {quote ? (
          <View style={styles.quote}>
            <Text style={styles.quoteName} numberOfLines={1}>
              {quoteName}
            </Text>
            <Text style={styles.quoteText} numberOfLines={2}>
              {quote.preview}
            </Text>
          </View>
        ) : null}

        {unavailable ? (
          <Text style={styles.pending}>{unreadableNote(message, isMine)}</Text>
        ) : (
          <>
            {message.media ? <MediaContent message={message} isMine={isMine} /> : null}
            {textToShow ? <Text style={styles.text}>{textToShow}</Text> : null}
          </>
        )}

        {undecryptable && onRetryDecrypt ? (
          <Pressable onPress={onRetryDecrypt} accessibilityRole="button" accessibilityLabel="Try again to read this message" hitSlop={8}>
            <Text style={styles.action}>Try again</Text>
          </Pressable>
        ) : null}

        <View style={styles.footer}>
          <Text style={styles.time}>{time}</Text>
          {isMine ? <DeliveryTicks status={status} /> : null}
        </View>

        {failed ? (
          <View style={styles.failedRow}>
            <Text style={styles.failedText}>{message.sendError ?? 'Not sent'}</Text>
            <Pressable onPress={() => onRetrySend?.(message.outboxId as string)} accessibilityRole="button" accessibilityLabel="Retry sending this message" hitSlop={8}>
              <Text style={styles.action}>Retry</Text>
            </Pressable>
            <Pressable onPress={() => onDiscardSend?.(message.outboxId as string)} accessibilityRole="button" accessibilityLabel="Delete this unsent message" hitSlop={8}>
              <Text style={styles.discard}>Delete</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
    </View>
  );

  // Swiping right reveals the reply arrow and replies on release.
  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={() => (
        <View style={styles.replyAction}>
          <Ionicons name="arrow-undo" size={20} color={palette.accent} />
        </View>
      )}
      onSwipeableOpen={(direction) => {
        if (direction !== 'left') return;
        swipeRef.current?.close();
        onReply?.(message);
      }}
      enabled={!selectMode}
      overshootLeft={false}
    >
      {bubble}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: 1, paddingHorizontal: spacing.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  bubbleMine: { backgroundColor: palette.bubbleOut },
  bubbleTheirs: { backgroundColor: palette.bubbleIn },
  bubbleSelected: { borderWidth: 2, borderColor: palette.accent },
  senderName: { color: palette.tick, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginBottom: 2 },
  text: { color: palette.text, fontSize: fontSize.md, lineHeight: 20 },
  // The quoted message: a violet rule down the left, name above, excerpt below.
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: palette.accent,
    backgroundColor: 'rgba(123,104,238,0.14)',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginBottom: spacing.xs,
  },
  quoteName: { color: palette.accent, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  quoteText: { color: palette.textMuted, fontSize: fontSize.sm, marginTop: 1 },
  replyAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  action: { color: palette.accent, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginTop: 4 },
  discard: { color: palette.danger, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: 4, flexWrap: 'wrap' },
  failedText: { color: palette.danger, fontSize: fontSize.xs, flexShrink: 1 },
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
