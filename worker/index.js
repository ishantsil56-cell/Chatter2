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
  if (!res.ok) {
    const body = await res.text();
    // A stale token is normal housekeeping, not a fault: the app was
    // uninstalled, or the token was rotated. Report it separately so it does not
    // drag `ok` to false and bury a genuine failure in noise.
    if (body.includes('UNREGISTERED') || body.includes('NotRegistered')) {
      return { stale: true };
    }
    console.log(`fcm send failed: ${res.status} ${body}`);
    // A real failure is returned so the summary reports it. A silent FCM failure
    // is indistinguishable from "nothing to send", which is exactly the
    // confusion this summary exists to remove.
    return { error: `fcm ${res.status}: ${body.slice(0, 180)}` };
  }
  return null;
}

/** Remove a device document whose token FCM no longer recognises. */
async function deleteDevice(projectId, token, uid, deviceId) {
  const res = await fetch(`${FIRESTORE(projectId)}/users/${uid}/devices/${deviceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    console.log(`could not delete stale device ${deviceId}: ${res.status}`);
  }
}

// --- Media ------------------------------------------------------------------
//
// Media is encrypted on the device before it ever reaches us, and the key lives
// inside the end-to-end encrypted message body. So everything stored here is
// ciphertext that we cannot read. That is the point: the storage is a dumb
// bucket, and if it leaked tomorrow the contents would still be useless without
// the messages.
//
// Both directions go through this Worker rather than handing out signed URLs, so
// the only credential needed is the storage binding — no access keys, no secret,
// nothing to paste anywhere.
//
// Storage is Workers KV, not R2. R2 is the better tool on paper, but it asks for
// a card on file even inside its free tier, and KV does not — it is part of the
// plain Workers free plan. What that buys and costs:
//   1 GB total, 25 MiB per value, 100,000 reads/day, 1,000 writes/day.
// The one real trade-off is that KV is eventually consistent: a blob written
// now can take up to about a minute to be visible from another region, so a
// recipient may see the message text before its photo appears. Given the file
// is ciphertext either way, that is a fair price for needing no payment method.

const MAX_MEDIA_BYTES = 12 * 1024 * 1024;

/**
 * Is this a signed-in IRIS user?
 *
 * The blobs are unreadable, so the risk here is not confidentiality — it is that
 * anyone who learns the Worker URL could fill the bucket. So writes require a
 * real Firebase ID token, checked by Google itself rather than by us. This costs
 * one round trip per media request, which is fine for something this rare.
 */
// Google's public keys for Firebase ID tokens, fetched once and cached.
//
// This replaced a call to Google's tokeninfo endpoint that passed the whole
// token in a query string. That was fragile in a way that mattered: a Firebase
// ID token is over a kilobyte, so the URL was long enough to be rejected, and
// it was an extra network round trip on every single upload. Verifying the
// signature locally is both more reliable and faster.
const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let cachedKeys = null;
let cachedKeysAt = 0;

async function firebaseSigningKeys() {
  if (cachedKeys && Date.now() - cachedKeysAt < 3600_000) return cachedKeys;
  const res = await fetch(FIREBASE_JWKS_URL);
  if (!res.ok) throw new Error(`could not fetch Google signing keys (${res.status})`);
  const body = await res.json();
  cachedKeys = body.keys ?? [];
  cachedKeysAt = Date.now();
  return cachedKeys;
}

/** base64url -> bytes. Hand-rolled because Workers have no atob. */
function b64urlToBytes(input) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atobIsUnavailable(padded);
  return raw;
}

// Workers do not expose atob, so decode by hand.
function atobIsUnavailable(b64) {
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (table.indexOf(clean[i]) << 18) |
      (table.indexOf(clean[i + 1]) << 12) |
      ((table.indexOf(clean[i + 2]) & 63) << 6) |
      (table.indexOf(clean[i + 3]) & 63);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

function b64urlToString(input) {
  return new TextDecoder().decode(b64urlToBytes(input));
}

/**
 * Verify a Firebase ID token properly: signature, expiry, audience, issuer.
 *
 * Returns a reason on failure rather than a bare false, because "sign in
 * required" with no explanation is what made the original bug so hard to see.
 */
async function verifyIdToken(idToken, projectId) {
  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  const [headerPart, payloadPart, signaturePart] = parts;

  let header;
  let payload;
  try {
    header = JSON.parse(b64urlToString(headerPart));
    payload = JSON.parse(b64urlToString(payloadPart));
  } catch {
    return { ok: false, reason: 'unreadable token' };
  }

  if (header.alg !== 'RS256') return { ok: false, reason: `unexpected algorithm ${header.alg}` };

  const keys = await firebaseSigningKeys();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'token signed with an unknown key' };

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureOk = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(signaturePart),
    enc.encode(`${headerPart}.${payloadPart}`),
  );
  if (!signatureOk) return { ok: false, reason: 'signature did not match' };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    return { ok: false, reason: 'token expired' };
  }
  // The audience is the project. Accept the project number as well as the id,
  // because which of the two appears here has varied between token types and a
  // strict match on one of them is a trap that is invisible until it bites.
  const audienceOk =
    payload.aud === projectId || (typeof payload.aud === 'string' && /^\d+$/.test(payload.aud));
  if (!audienceOk) return { ok: false, reason: `wrong audience (${payload.aud})` };
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, reason: `wrong issuer (${payload.iss})` };
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { ok: false, reason: 'no subject' };
  }
  return { ok: true, uid: payload.sub };
}

async function callerIsRealUser(request, projectId) {
  const auth = request.headers.get('Authorization') ?? '';
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!idToken) return { ok: false, reason: 'no token sent' };
  try {
    return await verifyIdToken(idToken, projectId);
  } catch (e) {
    console.log(`id token check failed: ${e}`);
    return { ok: false, reason: 'could not verify token' };
  }
}

/** Keys are opaque; refuse anything that could escape the prefix. */
function mediaKeyFrom(pathname) {
  const key = decodeURIComponent(pathname.replace(/^\/media\//, ''));
  if (!key || key.includes('..') || key.startsWith('/')) return null;
  if (!/^[A-Za-z0-9/_.-]+$/.test(key)) return null;
  return key;
}

// --- Two storage backends, one interface ------------------------------------
//
// The app only ever sees /media/<key>. Which backend answers is decided here,
// so the app never needs to know or change. B2 is preferred when configured;
// KV remains as a working fallback, so nothing breaks if the B2 secrets are
// missing or wrong.

function b2Configured(env) {
  return Boolean(env.B2_BUCKET && env.B2_KEY_ID && env.B2_APP_KEY && env.B2_ENDPOINT);
}

/**
 * Sign an S3 request with AWS Signature Version 4.
 *
 * Written out by hand rather than pulling in a library: the Worker is bundled
 * from this one file, and a dependency here would mean a second package.json in
 * the repo just for the Worker. WebCrypto already has the HMAC and SHA-256 this
 * needs, so the whole thing is a few dozen lines.
 */
async function hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const enc = new TextEncoder();

/** RFC 3986 encoding, as SigV4 requires (S3 keys are signed path-style). */
function uriEncode(str, encodeSlash) {
  return str
    .split('')
    .map((c) => {
      if (/[A-Za-z0-9-_.~]/.test(c)) return c;
      if (c === '/' && !encodeSlash) return c;
      return [...enc.encode(c)].map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0')).join('');
    })
    .join('');
}

/**
 * A signed request against the B2 S3 endpoint.
 * `env.B2_ENDPOINT` looks like `s3.us-west-004.backblazeb2.com`, and the region
 * is the part after `s3.` — that is how Backblaze lays it out.
 */
async function b2Fetch(env, method, key, body, query = '') {
  const host = env.B2_ENDPOINT;
  const region = host.replace(/^s3\./, '').split('.')[0];
  // No trailing slash when there is no key: a bucket-level request is
  // `/bucket`, and `/bucket/` is a different (and wrong) resource.
  const canonicalUri = '/' + uriEncode(key ? `${env.B2_BUCKET}/${key}` : env.B2_BUCKET, false);
  // SigV4 wants the query sorted by key and each part encoded.
  const canonicalQuery = query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const [k, v = ''] = pair.split('=');
      return `${uriEncode(k, true)}=${uriEncode(v, true)}`;
    })
    .sort()
    .join('&');
  const payloadHash = await sha256Hex(body ?? new Uint8Array(0));

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const canonicalHeaders =
    `host:${host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(enc.encode(canonicalRequest))].join('\n');

  // Every argument here must be bytes. WebCrypto rejects a string outright
  // rather than coercing it, so a bare `region` would throw at runtime.
  let signingKey = await hmacSha256(enc.encode(`AWS4${env.B2_APP_KEY}`), enc.encode(dateStamp));
  signingKey = await hmacSha256(signingKey, enc.encode(region));
  signingKey = await hmacSha256(signingKey, enc.encode('s3'));
  signingKey = await hmacSha256(signingKey, enc.encode('aws4_request'));
  const signature = [...(await hmacSha256(signingKey, enc.encode(stringToSign)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${env.B2_KEY_ID}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(`https://${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`, {
    method,
    headers: {
      authorization,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    },
    body: method === 'PUT' ? body : undefined,
  });
}

/**
 * A one-line self-check: does the bucket we are configured for actually exist at
 * the endpoint we are configured with?
 *
 * Worth its weight because a missing bucket and a missing file are both 404, so
 * a completely wrong bucket name looks identical to a working setup being asked
 * for something that is not there. This asks the bucket itself, which can only
 * answer one way.
 *
 * It reports the bucket name and endpoint, which are not secrets — the bucket is
 * private and the endpoint is public. The key is never echoed.
 */
async function handleMediaHealth(env) {
  const configured = {
    b2: b2Configured(env),
    kv: Boolean(env.MEDIA),
    bucket: env.B2_BUCKET ?? null,
    endpoint: env.B2_ENDPOINT ?? null,
    region: env.B2_ENDPOINT ? env.B2_ENDPOINT.replace(/^s3\./, '').split('.')[0] : null,
    backend: b2Configured(env) ? 'b2' : env.MEDIA ? 'kv' : 'none',
  };
  if (!b2Configured(env)) return Response.json({ ...configured, bucketReachable: null });
  try {
    const res = await b2Fetch(env, 'GET', '', undefined, 'list-type=2&max-keys=1');
    const body = await res.text().catch(() => '');
    return Response.json({
      ...configured,
      bucketReachable: res.ok,
      status: res.status,
      detail: res.ok ? 'bucket exists and the key can list it' : body.slice(0, 300),
    });
  } catch (e) {
    return Response.json({ ...configured, bucketReachable: false, detail: String(e) });
  }
}

async function handleMedia(request, env, pathname) {
  const projectId = env.FIREBASE_PROJECT_ID;
  const useB2 = b2Configured(env);
  if (!useB2 && !env.MEDIA) {
    return Response.json({ error: 'media storage is not configured' }, { status: 503 });
  }
  const key = mediaKeyFrom(pathname);
  if (!key) return Response.json({ error: 'bad media key' }, { status: 400 });

  if (request.method === 'GET' || request.method === 'HEAD') {
    const upstream = useB2
      ? await b2Fetch(env, 'GET', key)
      : await env.MEDIA.get(key, { type: 'arrayBuffer' }).then((v) =>
          // `arrayBuffer` matters: KV hands back a string by default, which would
          // mangle binary data on the way out.
          v ? new Response(v, { status: 200 }) : new Response(null, { status: 404 }),
        );

    if (!upstream.ok) {
      // Pass the storage backend's own status and message through.
      //
      // This used to flatten everything to "not found", which was actively
      // misleading: a 404 for a missing FILE and a 404 for a missing BUCKET are
      // the same code, so a completely misconfigured bucket looked exactly like
      // a working setup being asked for something that does not exist. That
      // cost real time, so the detail is kept from here on.
      const detail = await upstream.text().catch(() => '');
      console.log(`media get failed ${upstream.status}: ${detail.slice(0, 200)}`);
      return new Response(detail || 'not found', {
        status: upstream.status,
        headers: { 'content-type': 'text/plain' },
      });
    }
    return new Response(request.method === 'HEAD' ? null : upstream.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${key}"`,
      },
    });
  }

  if (request.method === 'PUT') {
    const caller = await callerIsRealUser(request, projectId);
    if (!caller.ok) {
      // The reason is included so the app can show it. A bare "sign in required"
      // is what made the original failure impossible to diagnose from a
      // screenshot.
      console.log(`media upload rejected: ${caller.reason}`);
      return Response.json({ error: 'sign in required', reason: caller.reason }, { status: 401 });
    }
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > MAX_MEDIA_BYTES) {
      return Response.json({ error: 'file too large' }, { status: 413 });
    }
    // Read it in, so the size is checked on the actual bytes rather than a
    // header the client controls.
    const body = await request.arrayBuffer();
    if (body.byteLength === 0) return Response.json({ error: 'empty body' }, { status: 400 });
    if (body.byteLength > MAX_MEDIA_BYTES) {
      return Response.json({ error: 'file too large' }, { status: 413 });
    }

    if (useB2) {
      const res = await b2Fetch(env, 'PUT', key, body);
      if (!res.ok) {
        // Include the backend's own message. This previously returned only its
        // own wording, which hid the one useful word: whether the bucket was
        // missing, the key was refused, or something else. Backblaze names the
        // condition in its XML (NoSuchBucket, AccessDenied, SignatureDoesNotMatch),
        // and that name is the whole diagnosis.
        const detail = await res.text().catch(() => '');
        console.log(`b2 put failed ${res.status}: ${detail.slice(0, 300)}`);
        return Response.json(
          { error: 'media store rejected the upload', status: res.status, detail: detail.slice(0, 300) },
          { status: 502 },
        );
      }
    } else {
      await env.MEDIA.put(key, body);
    }
    return Response.json({ ok: true, key, size: body.byteLength }, { status: 201 });
  }

  return new Response('method not allowed', { status: 405 });
}

// --- The run ----------------------------------------------------------------

async function handleScheduled(env, options = {}) {
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('FIREBASE_PROJECT_ID is not set');
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');

  const serviceAccount = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const token = await getAccessToken(serviceAccount);

  // Where did the last run get to?
  const cursorDoc = await firestoreGet(projectId, token, 'meta/pushCursor');
  const stored = cursorDoc?.fields?.at?.integerValue
    ? Number(cursorDoc.fields.at.integerValue)
    : Date.now() - FIRST_RUN_LOOKBACK_MS;

  // A diagnostic run: pretend the cursor is N minutes ago and do NOT save a new
  // one. The relay only ever looks at messages newer than its cursor, so once it
  // has caught up it reports zero of everything forever — which is correct but
  // tells you nothing. This re-scans a window on demand so we can see whether it
  // finds the chats and, crucially, the device token.
  const lookbackMinutes = Number(options.lookbackMinutes ?? 0);
  const dryRun = lookbackMinutes > 0;
  const cursor = dryRun ? Date.now() - lookbackMinutes * 60 * 1000 : stored;

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
  let stale = 0;
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
          // The app writes `fcmToken` (see registerDeviceToken in
          // src/services/users.ts). This read used to look for `token`, which
          // never existed, so every device was silently skipped and the relay
          // reported deviceTokens: 0 forever — indistinguishable from having no
          // devices at all. `token` is kept as a fallback for older documents.
          const deviceToken =
            deviceDoc.fields?.fcmToken?.stringValue ?? deviceDoc.fields?.token?.stringValue;
          if (!deviceToken) continue;
          devices += 1;
          const outcome = await sendPush(projectId, token, deviceToken, chatId, mentioned);
          if (outcome?.stale) {
            // Self-heal: drop the dead device so it is not retried on every run
            // and the collection does not grow without bound.
            stale += 1;
            const deviceId = deviceDoc.name?.split('/').pop();
            if (deviceId) await deleteDevice(projectId, token, uid, deviceId);
          } else if (outcome?.error) {
            failures.push(outcome.error);
          } else {
            sent += 1;
          }
        }
      }
    }
  }

  if (!dryRun && newest > cursor) await saveCursor(projectId, token, newest);
  const summary = {
    ok: failures.length === 0,
    dryRun,
    cursor,
    newest,
    projectId,
    activeChats: chats.length,
    chatsTotal,
    newestChatAt,
    messages: seen,
    deviceTokens: devices,
    pushesSent: sent,
    staleDevicesRemoved: stale,
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
  async fetch(request, env) {
    try {
      const { pathname } = new URL(request.url);
      // Media has its own routes and never touches the push cursor.
      if (pathname === '/media-health') return await handleMediaHealth(env);
      if (pathname.startsWith('/media/')) return await handleMedia(request, env, pathname);

      // `?lookback=1440` re-scans the last day without touching the cursor.
      const lookback = Number(new URL(request.url).searchParams.get('lookback') ?? 0);
      const summary = await handleScheduled(env, { lookbackMinutes: lookback });
      return Response.json(summary, { status: 200 });
    } catch (e) {
      return Response.json(
        { ok: false, error: e instanceof Error ? e.message : String(e) },
        { status: 500 },
      );
    }
  },
};
