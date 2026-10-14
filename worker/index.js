/**
 * IRIS push relay.
 *
 * IRIS is end-to-end encrypted, so the server only ever holds ciphertext and
 * cannot compose a meaningful notification. This Worker does the one thing the
 * free Firebase plan cannot: it runs on a timer, notices new messages, and asks
 * FCM to wake the recipients' phones.
 *
 * It deliberately sends a CONTENT-FREE notification — "New message" — because it
 * genuinely cannot read the text. The app shows the real message once it opens
 * and decrypts it locally.
 *
 * Runs on Cloudflare's free plan: one cron trigger a minute, well inside the
 * 100,000 requests a day allowance.
 *
 * Secrets it needs (Cloudflare dashboard → the Worker → Settings → Variables
 * and Secrets):
 *   FIREBASE_SERVICE_ACCOUNT  the whole service-account JSON, as a Secret
 *   FIREBASE_PROJECT_ID       the Firebase project id
 *
 * The service-account key is a credential: it lives only in Cloudflare's secret
 * store, never in this file and never in the repository.
 */

const FIRESTORE = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DATastore_SCOPE = 'https://www.googleapis.com/auth/datastore';

/** How far back to look on the very first run, if there is no cursor yet. */
const FIRST_RUN_LOOKBACK_MS = 10 * 60 * 1000;
/** Safety cap so one run can never fan out unboundedly. */
const MAX_MESSAGES_PER_RUN = 200;

// --- Service account → access token ----------------------------------------

function base64UrlFromBytes(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pemToPkcs8(pem) {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: serviceAccount.client_email,
    scope: `${DATastore_SCOPE} ${FCM_SCOPE}`,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(header)))}.` +
    `${base64UrlFromBytes(new TextEncoder().encode(JSON.stringify(claim)))}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  const assertion = `${unsigned}.${base64UrlFromBytes(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return json.access_token;
}

// --- Firestore (REST) -------------------------------------------------------

async function firestoreGet(projectId, token, path) {
  const res = await fetch(`${FIRESTORE(projectId)}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore read ${path} failed: ${res.status}`);
  return res.json();
}

/**
 * Run a structured query. `parent` is the document path to query under — the
 * database root for a top-level collection, or `chats/{id}` for its messages.
 */
async function firestoreRunQuery(projectId, token, parent, structuredQuery) {
  const base = parent ? `${FIRESTORE(projectId)}/${parent}` : FIRESTORE(projectId);
  const res = await fetch(`${base}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`firestore query failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows.map((r) => r.document).filter(Boolean);
}

/** Write the cursor, so the next run knows where this one stopped. */
async function saveCursor(projectId, token, at) {
  // No `currentDocument.exists=true` here: on the very first run the cursor
  // document does not exist yet, so demanding that it already does makes the
  // write fail and the cursor never advances — which would re-notify the same
  // messages on every run. A plain PATCH creates it if absent.
  const res = await fetch(`${FIRESTORE(projectId)}/meta/pushCursor`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { at: { integerValue: String(at) } } }),
  });
  if (!res.ok) console.log(`could not save the cursor: ${res.status} ${await res.text()}`);
}

// --- FCM --------------------------------------------------------------------

async function sendPush(projectId, token, deviceToken, chatId, mentioned) {
  // Still content-free — the Worker cannot read the text. It can tell *that*
  // this person was named, because the message carries a plaintext uid list,
  // and that is enough to make the notification worth looking at.
  const body = mentioned ? 'You were mentioned' : 'New message';
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token: deviceToken,
        notification: { title: 'IRIS', body },
        data: { chatId, mentioned: mentioned ? '1' : '0' },
        android: {
          priority: 'HIGH',
          notification: { channel_id: 'messages', color: '#767DC3' },
        },
      },
    }),
  });
  // A stale token is normal (app uninstalled); anything else is worth logging.
  if (!res.ok) {
    const body = await res.text();
    if (!body.includes('UNREGISTERED') && !body.includes('INVALID_ARGUMENT')) {
      console.log(`fcm send failed: ${res.status} ${body}`);
    }
    // Return the failure so the run summary can report it. A silent FCM failure
    // is indistinguishable from "nothing to send", which is exactly the
    // confusion this summary exists to remove.
    return `fcm ${res.status}: ${body.slice(0, 180)}`;
  }
  return null;
}

// --- The run ----------------------------------------------------------------

async function handleScheduled(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set');
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await getAccessToken(serviceAccount);

  // Where did the last run get to?
  const cursorDoc = await firestoreGet(projectId, token, 'meta/pushCursor');
  const cursor = cursorDoc?.fields?.at?.integerValue
    ? Number(cursorDoc.fields.at.integerValue)
    : Date.now() - FIRST_RUN_LOOKBACK_MS;

  // Which chats have seen activity since the cursor? A plain query on the chats
  // collection, filtered and ordered on the same field — which uses the
  // automatic single-field index. (An earlier version asked for every message
  // across all chats at once, which needs a hand-made collection-group index.)
  const chats = await firestoreRunQuery(projectId, token, null, {
    from: [{ collectionId: 'chats' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'lastMessageAt' },
        op: 'GREATER_THAN',
        value: { integerValue: String(cursor) },
      },
    },
    orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'ASCENDING' }],
    limit: 50,
  });

  // Ask the same collection for its newest entry, ignoring the cursor entirely.
  // This separates the two explanations for "activeChats: 0": either the relay
  // genuinely has nothing new to do, or the cursor has run ahead of the data and
  // is now skipping everything. If `newestChatAt` is below the cursor, the relay
  // is simply idle; if it is above, the cursor is the bug.
  let newestChatAt = null;
  try {
    const newestAny = await firestoreRunQuery(projectId, token, null, {
      from: [{ collectionId: 'chats' }],
      orderBy: [{ field: { fieldPath: 'lastMessageAt' }, direction: 'DESCENDING' }],
      limit: 1,
    });
    if (newestAny.length > 0) {
      newestChatAt = Number(newestAny[0].fields?.lastMessageAt?.integerValue ?? 0) || null;
    }
  } catch (e) {
    console.log(`could not read the newest chat: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Count every chat in the collection, cursor ignored, field filters ignored.
  //
  // This is the check that distinguishes "the relay has nothing new to do" from
  // "the relay is looking at the wrong database". A query against a project id
  // that is wrong, or a collection that is empty, returns zero rows and NO
  // error — which looks identical to an idle relay in every other field. If this
  // is 0 while the app clearly has chats, the project id secret is the problem,
  // not the cursor.
  let chatsTotal = null;
  try {
    const all = await firestoreRunQuery(projectId, token, null, {
      from: [{ collectionId: 'chats' }],
      limit: 100,
    });
    chatsTotal = all.length;
  } catch (e) {
    chatsTotal = `error: ${e instanceof Error ? e.message : String(e)}`;
  }

  let newest = cursor;
  let sent = 0;
  let seen = 0;
  let devices = 0;
  const failures = [];

  for (const chat of chats) {
    const fields = chat.fields ?? {};
    const chatId = chat.name.split('/').pop();
    const lastMessageAt = Number(fields.lastMessageAt?.integerValue ?? 0);
    if (lastMessageAt > newest) newest = lastMessageAt;

    const memberIds = (fields.memberIds?.arrayValue?.values ?? []).map((v) => v.stringValue);

    // The new messages in this chat.
    const messages = await firestoreRunQuery(projectId, token, `chats/${chatId}`, {
      from: [{ collectionId: 'messages' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'createdAt' },
          op: 'GREATER_THAN',
          value: { integerValue: String(cursor) },
        },
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
      limit: MAX_MESSAGES_PER_RUN,
    });

    for (const message of messages) {
      const m = message.fields ?? {};
      const createdAt = Number(m.createdAt?.integerValue ?? 0);
      if (createdAt > newest) newest = createdAt;
      seen += 1;

      const senderId = m.senderId?.stringValue;
      // system messages carry no envelope and are not worth a push
      if (m.kind?.stringValue === 'system' || !senderId) continue;

      // Who was named with `#`. Stored in the clear precisely so this job can
      // read it without decrypting anything.
      const mentions = (m.mentions?.arrayValue?.values ?? []).map((v) => v.stringValue);

      for (const uid of memberIds) {
        if (!uid || uid === senderId) continue;
        const mentioned = mentions.includes(uid);
        // Listing a subcollection path returns { documents: [...] }.
        const deviceList = await firestoreGet(projectId, token, `users/${uid}/devices`);
        for (const deviceDoc of deviceList?.documents ?? []) {
          const deviceToken = deviceDoc.fields?.token?.stringValue;
          if (!deviceToken) continue;
          devices += 1;
          const failure = await sendPush(projectId, token, deviceToken, chatId, mentioned);
          if (failure) failures.push(failure);
          else sent += 1;
        }
      }
    }
  }

  if (newest > cursor) await saveCursor(projectId, token, newest);
  const summary = {
    ok: failures.length === 0,
    cursor,
    newest,
    projectId,
    activeChats: chats.length,
    chatsTotal,
    newestChatAt,
    messages: seen,
    deviceTokens: devices,
    pushesSent: sent,
    failures: failures.slice(0, 5),
  };
  console.log(`run complete: ${JSON.stringify(summary)}`);
  return summary;
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      handleScheduled(env).catch((e) => {
        // Surfaced in the Worker's log, which is the place to look if pushes stop.
        console.log(`push relay failed: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
      }),
    );
  },

  // Hitting the Worker in a browser runs the same job once — handy for testing.
  //
  // It now answers with what the run actually did: how many chats and messages
  // it looked at, how many device tokens it found, how many pushes it sent, and
  // any FCM error. Only counts and status codes, never message content — but it
  // does mean the URL reveals those counts, so keep it to yourself.
  async fetch(_request, env) {
    try {
      const summary = await handleScheduled(env);
      return Response.json(summary, { status: 200 });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  },
};
