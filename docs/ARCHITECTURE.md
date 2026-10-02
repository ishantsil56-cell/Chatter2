# Architecture & threat model

## Goal

A messenger where the server is treated as **untrusted infrastructure**. Firebase stores and routes ciphertext; it never holds a key that can read message contents, media, or the media key.

## Trust boundaries

| Component | Trusted with | NOT trusted with |
|---|---|---|
| The device | plaintext, private keys, message keys | — |
| Firebase Auth | phone number, uid | message contents |
| Firestore | ciphertext envelopes, chat metadata, presence | plaintext, private keys |
| Firebase Storage | encrypted media blobs | plaintext media, media keys |
| FCM | a content-free notification | message contents |
| Cloud Functions | routing, prekey consumption | plaintext, private keys |

The device is the root of trust. Everything else is assumed hostile.

## Key hierarchy

```
Identity (long-lived, per device)
├── X25519 identity key pair      → DH identity
├── Ed25519 signing key pair      → authenticates the signed prekey
├── Signed prekey (X25519)        → rotated; signed by the signing key
└── One-time prekeys (X25519)     → one per new session, then destroyed

Per peer session
└── Double Ratchet state
    ├── root key
    ├── sending / receiving chain keys
    └── cached message keys (bounded, for out-of-order messages)
```

Public keys are published; private keys live in the OS keychain (`react-native-keychain`) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Sessions are encrypted at rest with a random master key (also in the keychain) before landing in AsyncStorage.

## Message flow

```
alice                        firestore                      bob
  │  fetch prekey bundle ───────► (function) ──► delete 1 OTPK
  │  ◄──── bundle ───────────────┘
  │
  │  X3DH → SK
  │  DR init(sender)
  │
  │  encrypt(text) → {ct, header}
  │  write message ─────────────► chats/{id}/messages/{m}
  │                                    │
  │                                    ├──► push function → FCM ("New message")
  │                                    │
  │  ◄── snapshot ─────────────────────┘
  │                               DR init(receiver)
  │                               decrypt(header, ct) → text
  │
  │  ◄──────── receipt (delivered/read) ──────────
```

Each member (except the sender) gets their own envelope, so the server sees only opaque blobs. The sender caches their own plaintext locally, since they don't run the receiving ratchet for their own messages.

## Why these choices

- **X3DH** — gives mutual authentication (via the signed prekey), forward secrecy, and one-time-prekey freshness, all asynchronously (no simultaneous online requirement).
- **Double Ratchet** — a fresh key per message, plus a DH ratchet each turn, so a single key compromise doesn't cascade.
- **Per-recipient envelopes for groups** — simple and correct, at the cost of O(n) ciphertext. A production system would use sender keys.
- **Separate identity and signing keys** — Signal uses one Curve25519 key with XEdDSA for signatures; we use two keys (X25519 for DH, Ed25519 for signatures) to avoid implementing XEdDSA. Functionally equivalent, slightly larger bundles.

## Threat model — what this protects against

✅ A **compromised or curious server operator** cannot read message contents, media, or media keys.
✅ **Network attackers** see only TLS + ciphertext.
✅ **Message tampering** is detected — the AEAD tag fails and decryption is rejected (tested).
✅ **Replay / out-of-order** delivery is handled by skipped-message keys; a replayed message fails to decrypt.
✅ **Device theft** doesn't reveal private keys (keychain) or history (encrypted at rest, key in keychain).
✅ **A stolen prekey** can't be reused — one-time prekeys are consumed atomically server-side.

## Threat model — what it does NOT protect against

⚠️ **This code is not audited.** Do not deploy it for users whose physical safety depends on it without a professional review and a vetted library.
⚠️ **MITM on first contact** — you must compare safety numbers out-of-band (the app exposes `safetyNumberWithPeer`; a UI to display it is a natural next step). Without that, an attacker who controls the prekey distribution could substitute keys.
⚠️ **Compromised endpoint** — if the device is rooted/jailbroken with the keychain unlocked, all bets are off.
⚠️ **Metadata** — who talks to whom, when, and how often is visible to the server (as with Signal).
⚠️ **No deniability guarantees** beyond what the primitives give.
⚠️ **Key verification UI** is not wired into a screen yet — the function exists, the button doesn't.
⚠️ **Side channels / fuzzing** — no constant-time guarantees beyond `constantTimeEqual`, and no fuzz testing.

## Testing

`src/services/crypto/__tests__/run.ts` drives two independent `SessionManager`s through:

1. X3DH handshake + first message
2. Reply direction (DH ratchet step)
3. Multiple messages, verifying ciphertexts are unique
4. Out-of-order delivery (skipped message keys)
5. Tamper detection
6. Safety-number agreement
7. Persistence across a manager restart

Run with `npm run test:crypto`.
