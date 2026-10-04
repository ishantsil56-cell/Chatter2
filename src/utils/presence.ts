import type { PresenceState } from '@/types';

/** A heartbeat older than this means the app was killed or lost its connection. */
export const PRESENCE_STALE_MS = 70_000;

/** Is this user really online right now? Trusts `online` only while the heartbeat is fresh. */
export function isOnline(presence: PresenceState | undefined, now: number = Date.now()): boolean {
  return !!presence?.online && now - presence.lastSeen < PRESENCE_STALE_MS;
}

/** Typing entries older than this are ignored (the typist stopped, was killed, or went offline). */
export const TYPING_STALE_MS = 8_000;

export function activeTypers(
  entries: { uid: string; at: number }[],
  exceptUid: string,
  now: number = Date.now(),
): string[] {
  return entries.filter((e) => e.uid !== exceptUid && now - e.at < TYPING_STALE_MS).map((e) => e.uid);
}
