import { format, isToday, isYesterday, isThisYear } from 'date-fns';

/** Timestamp for a chat-list row: time today, "Yesterday", else a date. */
export function formatChatTimestamp(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return format(d, 'HH:mm');
  if (isYesterday(d)) return 'Yesterday';
  if (isThisYear(d)) return format(d, 'dd/MM');
  return format(d, 'dd/MM/yyyy');
}

/** Timestamp shown inside a message bubble. */
export function formatMessageTime(ts: number): string {
  return format(new Date(ts), 'HH:mm');
}

/** Day separator label above a run of messages. */
export function formatDaySeparator(ts: number): string {
  const d = new Date(ts);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'dd MMMM yyyy');
}

/**
 * "Last seen" line under a name, WhatsApp-style. `now` is injectable so the
 * checks can pin it; callers pass nothing.
 */
export function formatLastSeen(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const time = format(d, 'HH:mm');
  if (sameDay(ts, now)) return `last seen today at ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(ts, yesterday.getTime())) return `last seen yesterday at ${time}`;
  if (d.getFullYear() === new Date(now).getFullYear()) return `last seen ${format(d, 'dd MMMM')}`;
  return `last seen ${format(d, 'dd/MM/yyyy')}`;
}

export function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
