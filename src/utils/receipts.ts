/**
 * Delivery / read receipt semantics, in one tested place.
 *
 * A message's `receipts` map holds one entry per member. For the sender's tick:
 *   - ONE grey tick      : sent (at least one recipient hasn't received it yet)
 *   - TWO grey ticks     : delivered to EVERY other member
 *   - TWO blue ticks     : read by EVERY other member
 * "Every other member" means the chat's CURRENT members — someone who left a
 * group must not keep a message from ever turning blue, and someone who joined
 * later was never a recipient.
 */

import type { MessageStatus, UserId } from '@/types';

const RANK: Record<MessageStatus, number> = {
  sending: 0,
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

export function receiptRank(status: MessageStatus | undefined): number {
  return status ? RANK[status] : 0;
}

/** Receipts only ever move forward. Returns the stronger of the two. */
export function mergeReceipt(current: MessageStatus | undefined, next: MessageStatus): MessageStatus {
  return receiptRank(next) >= receiptRank(current) ? next : (current as MessageStatus);
}

export function deliveryStatus(
  receipts: Record<UserId, MessageStatus> | undefined,
  senderId: UserId,
  memberIds: UserId[],
): MessageStatus {
  const recipients = memberIds.filter((m) => m !== senderId);
  if (recipients.length === 0) return 'sent';
  const ranks = recipients.map((u) => receiptRank(receipts?.[u]));
  const lowest = Math.min(...ranks);
  if (lowest >= RANK.read) return 'read';
  if (lowest >= RANK.delivered) return 'delivered';
  return 'sent';
}
