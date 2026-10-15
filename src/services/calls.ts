/**
 * Voice & video calls.
 *
 * WhatsApp runs a proprietary native VoIP stack (custom signalling over its
 * chat socket, SRTP media, P2P with relay fallback). Rebuilding that is a
 * multi-year project — IRIS should NOT.
 *
 * Recommended IRIS architecture (what this scaffold implements):
 * - Signalling: Firestore `calls/{callId}` document (ringing → active → ended).
 * - Media: a managed SFU — LiveKit Cloud or a self-hosted livekit-server.
 *   The client SDK (livekit-react-native) handles NAT traversal, simulcast,
 *   noise suppression and E2E media encryption (livekit e2ee).
 * - Tokens: minted by a tiny backend (Cloudflare Worker, like the media
 *   worker) that checks Firestore membership, then signs a LiveKit token.
 *   The token is opaque to Firestore.
 *
 * Firestore layout:
 *   calls/{callId}  → CallSession (see @/types/extended)
 *
 * Call flow:
 *   1. Caller creates `calls/{id}` with state 'ringing' (+ FCM data push).
 *   2. Callee joins → sets state 'active', both fetch a LiveKit token.
 *   3. Either hangs up → state 'ended', endedAt set.
 *   4. A `kind: 'call_log'` system message is appended to the chat.
 */

import { db } from './firebase';
import type { FirebaseFirestoreTypes } from '@react-native-firebase/firestore';
import { randomId } from '@/utils/id';
import { scope } from '@/utils/logger';
import type { ChatId, UserId } from '@/types';
import type { CallKind, CallSession, CallState } from '@/types/extended';

const log = scope('calls');

const CALLS = 'calls';
/** Ring timeout before the call is marked missed. */
export const RING_TIMEOUT_MS = 45_000;

/** Start an outgoing call. Returns the call id. */
export async function startCall(
  chatId: ChatId,
  kind: CallKind,
  initiatorId: UserId,
  participantIds: UserId[],
): Promise<string> {
  const id = randomId();
  const now = Date.now();
  const session: CallSession = {
    id,
    chatId,
    kind,
    state: 'ringing',
    initiatorId,
    participantIds,
    startedAt: now,
    endedAt: null,
  };
  await db.collection(CALLS).doc(id).set(session);
  // TODO: send FCM data message { type: 'incoming_call', callId: id } via push.ts
  log('call started', { id, kind, chatId });
  return id;
}

/** Live call state. */
export function subscribeCall(
  callId: string,
  cb: (call: CallSession | null) => void,
  onError?: (e: Error) => void,
): () => void {
  return db
    .collection(CALLS)
    .doc(callId)
    .onSnapshot(
      (snap: FirebaseFirestoreTypes.DocumentSnapshot) =>
        cb(snap.exists ? (snap.data() as unknown as CallSession) : null),
      (e: Error) => {
        log('subscribeCall failed', e);
        onError?.(e);
      },
    );
}

/** Accept an incoming call (callee). */
export async function acceptCall(callId: string, uid: UserId): Promise<void> {
  await db.collection(CALLS).doc(callId).update({ state: 'active' satisfies CallState });
  log('call accepted', { callId, uid });
}

/** End a call from any participant. */
export async function endCall(callId: string, uid: UserId): Promise<void> {
  await db
    .collection(CALLS)
    .doc(callId)
    .update({ state: 'ended' satisfies CallState, endedAt: Date.now() });
  log('call ended', { callId, uid });
}

/** Decline without joining. */
export async function declineCall(callId: string, uid: UserId): Promise<void> {
  await db.collection(CALLS).doc(callId).update({ state: 'declined' satisfies CallState });
}

/**
 * Fetch a LiveKit access token for this call.
 *
 * The worker (see docs/CALLING.md in this scaffold) verifies that `uid` is a
 * participant of the call, then returns a short-lived JWT. Never mint tokens
 * client-side — the API key must stay server-side.
 */
export async function fetchCallToken(
  workerBaseUrl: string,
  callId: string,
  uid: UserId,
  idToken: string,
): Promise<{ token: string; wsUrl: string }> {
  const res = await fetch(`${workerBaseUrl}/call-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ callId, uid }),
  });
  if (!res.ok) throw new Error(`call-token failed: ${res.status}`);
  return (await res.json()) as { token: string; wsUrl: string };
}
