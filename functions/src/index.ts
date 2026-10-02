/**
 * Cloud Functions for Chatter.
 *
 * Two jobs that genuinely must run server-side:
 *
 *  1. fetchPreKeyBundle — hands a caller a peer's prekey bundle and *consumes*
 *     one one-time prekey atomically. Clients cannot delete another user's
 *     prekey under the security rules, so this can't live on the device.
 *
 *  2. onNewMessage — fans out a content-free push notification to the other
 *     members' devices. The message body is end-to-end encrypted, so the
 *     notification deliberately carries no text.
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

initializeApp();
const db = getFirestore();

interface PreKeyBundleResponse {
  identityKey: string;
  signingKey: string;
  signedPreKey: string;
  signedPreKeySignature: string;
  signedPreKeyId: number;
  oneTimePreKey: { id: number; publicKey: string } | null;
}

export const fetchPreKeyBundle = onCall(async (request): Promise<PreKeyBundleResponse> => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const peerId = (request.data as { peerId?: string })?.peerId;
  if (!peerId || typeof peerId !== 'string') {
    throw new HttpsError('invalid-argument', 'peerId is required.');
  }

  const userRef = db.doc(`users/${peerId}`);

  return db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new HttpsError('not-found', 'No such user.');
    }
    const u = userSnap.data()!;
    if (!u.signedPreKey || !u.signedPreKeySignature) {
      throw new HttpsError('failed-precondition', 'That user has not published prekeys yet.');
    }

    // Grab one unused one-time prekey, if any remain.
    const prekeysSnap = await tx.get(userRef.collection('prekeys').limit(1));
    let oneTimePreKey: { id: number; publicKey: string } | null = null;
    if (!prekeysSnap.empty) {
      const doc = prekeysSnap.docs[0]!;
      const data = doc.data() as { id: number; publicKey: string };
      oneTimePreKey = { id: data.id, publicKey: data.publicKey };
      tx.delete(doc.ref); // single-use: never hand this one out again
    }

    return {
      identityKey: u.identityKey,
      signingKey: u.signingKey ?? u.identityKey,
      signedPreKey: u.signedPreKey,
      signedPreKeySignature: u.signedPreKeySignature,
      signedPreKeyId: u.preKeyId ?? 1,
      oneTimePreKey,
    };
  });
});

export const onNewMessage = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const message = snapshot.data() as {
    senderId: string;
    kind: string;
    envelopes?: Record<string, unknown>;
  };

  // System messages and anything without recipients need no push.
  if (message.kind === 'system' || !message.envelopes) return;

  const { chatId } = event.params;

  try {
    const [chatSnap, senderSnap] = await Promise.all([
      db.doc(`chats/${chatId}`).get(),
      db.doc(`users/${message.senderId}`).get(),
    ]);

    const members: string[] = chatSnap.data()?.memberIds ?? [];
    const recipients = members.filter((m) => m !== message.senderId);
    if (recipients.length === 0) return;

    const senderName = senderSnap.data()?.displayName || 'New message';

    // Collect every recipient's device tokens.
    const tokens: string[] = [];
    for (const uid of recipients) {
      const devices = await db.collection(`users/${uid}/devices`).get();
      for (const device of devices.docs) {
        const token = (device.data() as { fcmToken?: string }).fcmToken;
        if (token) tokens.push(token);
      }
    }
    if (tokens.length === 0) return;

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        // Content-free on purpose: the server cannot read the message.
        title: senderName,
        body: 'New message',
      },
      data: { chatId, type: 'message' },
      android: { priority: 'high' },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    logger.info(`push sent for ${chatId}: ${response.successCount}/${tokens.length} delivered`);
  } catch (e) {
    logger.error('push fan-out failed', e);
  }
});

/**
 * Housekeeping: prune device tokens Firebase reports as unregistered. Wire this
 * to a scheduled trigger if you want it automatic.
 */
export const cleanupDeviceToken = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const deviceId = (request.data as { deviceId?: string })?.deviceId;
  if (!deviceId) throw new HttpsError('invalid-argument', 'deviceId is required.');
  await db.doc(`users/${request.auth.uid}/devices/${deviceId}`).delete();
  return { ok: true };
});
