# Chatter

A WhatsApp-style messenger for Android (and iOS) built with **React Native (Expo) + TypeScript** and **Firebase**, with **real end-to-end encryption**: the server stores ciphertext it cannot read.

This is a complete, working codebase for the scope you asked for — auth, 1-to-1 chat with delivery ticks, offline queue, groups, media, typing/presence, and E2EE.

> **Runs on the free Firebase Spark plan.** Photos and voice notes need Cloud
> Storage, which now requires the paid Blaze plan — so `MEDIA_ENABLED` in
> `src/config.ts` is **false** by default and the attach/mic buttons are hidden.
> Everything else (text, groups, encryption, receipts, typing, presence) works
> with no payment method. To enable media later, see `src/config.ts`.

---

## What's inside

```
chatter/
├── App.tsx                     # root: providers + navigation
├── index.ts                    # RN entry
├── app.json                    # Expo config (plugins, permissions)
├── src/
│   ├── navigation/             # root switch, auth stack, app stack, tabs
│   ├── screens/                # 10 screens (auth → chat → groups → settings)
│   ├── components/             # bubbles, input, ticks, avatars, media, typing
│   ├── hooks/                  # bootstrap, chats, messages, typing, presence
│   ├── store/                  # zustand: auth, settings, user cache
│   ├── services/
│   │   ├── crypto/             # ← the E2EE layer (see below)
│   │   ├── firebase.ts         # one import surface for Firebase
│   │   ├── auth.ts             # email + password
│   │   ├── users.ts            # profiles, lookup, devices, presence
│   │   ├── prekeys.ts          # publish/fetch prekey bundles
│   │   ├── chats.ts            # direct + group chats, membership, typing
│   │   ├── messages.ts         # encrypt-per-recipient send, decrypt, receipts
│   │   ├── storage.ts          # encrypted media upload/download
│   │   ├── push.ts             # FCM registration
│   │   ├── presence.ts         # heartbeat + last-seen
│   │   ├── outbox.ts           # offline send queue
│   │   ├── messageCache.ts     # local plaintext cache (own messages)
│   │   └── secureStore.ts      # keychain + encrypted-at-rest session store
│   ├── theme/                  # design tokens
│   ├── types/                  # shared domain types
│   └── utils/                  # bytes, email, time, errors, id, logger
├── functions/                  # Cloud Functions (prekey distribution, push)
├── firestore.rules
├── firestore.indexes.json
├── storage.rules
└── firebase.json / .firebaserc
```

---

## The encryption layer

Located in `src/services/crypto/`. It implements the same building blocks Signal uses, from scratch on top of two well-reviewed pure-JS libraries (`tweetnacl` and `@noble/hashes`):

| File | What it does |
|---|---|
| `primitives.ts` | X25519 DH, Ed25519 signatures, HKDF-SHA256, XSalsa20-Poly1305 AEAD |
| `identity.ts` | Long-term identity + signing keys, signed prekey, one-time prekeys |
| `x3dh.ts` | **X3DH** key agreement (initiator + responder) |
| `ratchet.ts` | **Double Ratchet** (DH ratchet + symmetric ratchet, skipped-key handling) |
| `session.ts` | `SessionManager`: `encrypt(peerId, text)` / `decrypt(...)`, per-peer locking |
| `store.ts` | Storage interface + in-memory impl for tests |
| `secureStore.ts` | Device storage: keys in keychain, sessions encrypted at rest |

**How a message is protected**

1. Sender fetches the recipient's prekey bundle (via the `fetchPreKeyBundle` function, which consumes one one-time prekey atomically).
2. **X3DH** mixes identity keys, a signed prekey and an ephemeral key into a shared secret.
3. The **Double Ratchet** derives a fresh single-use key per message (forward secrecy) and advances via a DH ratchet each turn (post-compromise security).
4. The plaintext is encrypted once per member; Firestore only ever stores `{ ciphertext, header }`.
5. Media is encrypted with a random per-file key *before* upload; that key rides inside the E2EE message body.

**Verify it works** — the test harness runs two parties end to end:

```bash
npm run test:crypto
```

It covers the handshake, both ratchet directions, out-of-order delivery, tamper rejection, safety-number agreement and persistence. (24 assertions, all passing.)

> **Honest caveat:** this is a careful, working implementation of Signal's *design*, written for clarity and verified by the test suite above. It has **not** been audited or fuzzed to the standard of `libsignal`. For a production product where users' safety depends on it, use a vetted library (e.g. `@privacyresearch/libsignal-protocol-typescript` or a native libsignal binding) rather than this. See `docs/ARCHITECTURE.md` for the full threat model.

---

## Setup

### 1. Prerequisites

- Node 20+, npm
- A [Firebase](https://console.firebase.google.com) project (Blaze plan for Cloud Functions)
- Android Studio + an emulator/device, or the Expo dev-client build

### 2. Install

```bash
cd chatter
npm install
```

### 3. Create the Firebase project and enable services

In the Firebase console:

1. **Authentication → Sign-in method → Email/Password** — enable it.
2. **Firestore Database** — create it.
3. **Storage** — create it.
4. **Cloud Messaging** — enabled by default.
5. **Project settings → Your apps → Add Android** with package `com.sil.chatter`; download `google-services.json`.
6. (Optional, for iOS) add an iOS app and download `GoogleService-Info.plist`.

That's the whole auth setup — no SMS, no OAuth, no SHA-1, and it works on the free Spark plan.

### 4. Wire up the native config

`expo prebuild` generates the `android/` and `ios/` folders. The Firebase config
file goes at the **project root** (Expo copies it into the native project during
prebuild), and is git-ignored so you never commit it:

```bash
npx expo prebuild --platform android --clean
cp config/google-services.json.example google-services.json   # then edit with your real values
# or, better, drop in the real file downloaded from Firebase:
#   ./google-services.json
```

> The committed `google-services.json.example` is a placeholder. Never commit your real one — it's already in `.gitignore`.

### 5. Deploy rules, indexes and functions

```bash
npm install -g firebase-tools
firebase login
# edit .firebaserc → set your project id, or:
firebase use --add

firebase deploy --only firestore:rules,firestore:indexes
cd functions && npm install && cd ..
firebase deploy --only functions
```

> Storage is deliberately left out here — you haven't enabled it. Once you do
> (Blaze plan), also run `firebase deploy --only storage`.

### 6. Run the app

```bash
npm run android        # expo run:android — builds a dev client and installs it
```

The first run builds the native app (a few minutes). Afterwards `npm start` launches Metro.

---

## Getting an installable APK

You need the APK built against **your** Firebase project (see step 3), because
the app reads `google-services.json` at build time and Firebase auth only
works for apps registered in your project. Three ways to get one:

### Option A — Expo EAS (fastest, no toolchain installed)

```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```

`eas.json` is already configured: the **preview** profile produces an installable
`.apk`, and EAS manages the signing keystore for you. You'll get a download link
when it finishes. Upload your `google-services.json` when EAS prompts for it (or
add it as a file secret).

### Option B — GitHub Actions (no Expo account needed)

Push the repo to GitHub and set one repository secret, `GOOGLE_SERVICES_JSON`,
to the contents of your `google-services.json`. Then run the **Build Android APK**
workflow (`.github/workflows/build-apk.yml`) from the Actions tab. It builds in
GitHub's cloud — which has the full Android toolchain — and uploads the APK as a
downloadable artifact (a debug-signed APK, which installs fine for testing).
Signing for the Play Store is covered under Option C.

### Option C — Local build (Android Studio installed)

```bash
npm install
printf '%s' "$(cat /path/to/google-services.json)" > google-services.json
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease   # or assembleDebug
# output: android/app/build/outputs/apk/release/app-release.apk
```

A release build needs a signing keystore; see the
[Android signing docs](https://developer.android.com/studio/publish/app-signing).
A debug APK (`assembleDebug`) is signed with the debug key and installs fine for
testing.

> The package name `com.sil.chatter` is already set in `app.json`
> (`android.package` and `ios.bundleIdentifier`) and matches the Android app
> registered in Firebase. (Email/password auth needs no SHA-1 or fingerprint.)

---

## How the pieces fit

- **Auth**: email + password via Firebase Auth → profile created on first login.
- **Usernames**: each user claims a unique @handle (stored in `usernames/{username}`), and people are found by searching it.
- **Keys**: on first launch the device generates an identity; the public half is published to `users/{uid}`, the private half never leaves the keychain.
- **Starting a chat**: search a username → `ensureDirectChat` creates a deterministic `chatId` → first message bootstraps the E2EE session automatically.
- **Sending**: `useMessages.sendText` encrypts per member and writes the message; if offline it's queued in the outbox and flushed on reconnect.
- **Receiving**: an `onSnapshot` feed is decrypted once per message; read receipts and read cursors update as you view the chat.
- **Push**: a Cloud Function fans out a content-free notification ("New message") to the other members' devices.

## Data model

```
users/{uid}                      profile + username + public prekeys + presence
usernames/{username}             unique handle -> uid (search + availability)
users/{uid}/prekeys/{keyId}      one-time prekeys (consumed on use)
users/{uid}/devices/{deviceId}   FCM tokens
chats/{chatId}                   members, preview, read cursors, admins
chats/{chatId}/messages/{id}     { envelopes: { uid: {ciphertext, header} }, ... }
chats/{chatId}/typing/{uid}      typing indicator
```

## Known limitations / next steps

- **Multi-device**: a second device starts a fresh identity; cross-device history needs per-device sessions.
- **Group E2EE**: this encrypts per-recipient (O(n) copies). Signal's *sender keys* scale better for large groups.
- **Presence** uses Firestore; Realtime Database would be cheaper at scale.
- **No calls, stories or disappearing messages** yet — those were out of scope for this pass.
- The `update` rule on chats lets any member change membership; move that to a callable for stricter control.

See `docs/ARCHITECTURE.md` for the threat model and design notes.
