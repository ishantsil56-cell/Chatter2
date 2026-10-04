# Architecture & threat model

## Goal

A messenger where the server is treated as **untrusted infrastructure**. Firebase stores and routes ciphertext; it never holds a key that can read message contents, media, or the media key.

## Trust boundaries

| Component | Trusted with | NOT trusted with |
|---|---|---|
| The device | plaintext, private keys, message keys | — |
| Firebase Auth | email, uid | message contents |
| Firestore | ciphertext envelopes, chat metadata, presence | plaintext, private keys |
| Firebase Storage | encrypted media blobs | plaintext media, media keys |
| FCM | (unused on the free plan — see `PUSH_ENABLED`) | message contents |

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

There is **no server code** (free Spark plan): clients talk to Firestore directly and the security rules enforce who may do what.

```
alice                        firestore                      bob
  │  read bob's bundle + a random one-time prekey (plain reads)
  │  ◄──── bundle ───────────────┘
  │  X3DH → SK ; DR init(sender)
  │  encrypt(text) → {ct, header}  (+ a self-copy sealed with alice's history key)
  │  save to outbox (sealed) ─ set chats/{id}/messages/{clientId} ─►
  │                                    │  ◄── snapshot ───────────────┘
  │                                    │  X3DH (from header) + DR init(receiver)
  │                                    │  decrypt once → plaintext cached on-device (sealed)
  │                                    │  bob deletes the used one-time prekey
  │  ◄──────── receipts.bob = delivered / read ──────────────
```

* **One document per message, id chosen by the sender** (`clientId`), so a retry can never duplicate a message.
* **The X3DH header rides on every message until the peer answers**, so a lost, delayed or retried first message can't strand the conversation (Signal's "pre-key message" rule).
* **A session is saved only after a message decrypts with it** and a one-time prekey is consumed only then, so a bad first message can't poison anything.
* **Glare** (both sides start a session at once) is resolved deterministically: the session started by the lower identity key wins; the other side adopts it.
* **Recovery without a server:** a recipient that can't decrypt writes `chats/{id}/resendRequests/{requester}__{sender}`. The sender's app (running `chatSync`) re-encrypts the original text — from its local cache or its history-key copy — using the signed prekey only (no one-time prekey to collide on) and swaps the new envelope into the message. Nothing is ever sent in the clear.
* **Receipts** are written as nested fields and only move forward (`sent < delivered < read`), enforced by the rules. A sender's ticks are judged against the chat's *current* members.
* **Chat list previews** on the server are placeholders ("Message", "Photo"); the real text comes from the on-device cache.

### Reading your own history after a reinstall

You can't decrypt your own outgoing envelopes, and a reinstall wipes the device cache. So each message also carries a **self-envelope**: the text sealed (XSalsa20-Poly1305) with a random 32-byte *history key*. That key lives in the keychain and is also stored at `users/{uid}/backup/history`, **wrapped with a key derived from your account password (scrypt, N=2^14)**. After a reinstall you sign in with the same password, the wrapped key is unwrapped and your sent history is readable again.

Trade-offs: the wrapped key is only as strong as your password, so someone who stole your Firestore data *and* guessed your password could read what **you sent** (never what you received, and never your identity or ratchet keys). If you reset a forgotten password the old backup can't be opened; Settings offers "start new backup". Messages you *received* before a reinstall are not recoverable — their ratchet keys were only ever on the old device.

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
✅ **A stolen prekey** can't be replayed against a live session — handshakes already adopted are remembered, and the owner deletes a one-time prekey from the server once used. (Without server code the pool can't be drained atomically, so two senders may occasionally pick the same key; that first message fails closed and is recovered by the resend flow above.)

## Threat model — what it does NOT protect against

⚠️ **This code is not audited.** Do not deploy it for users whose physical safety depends on it without a professional review and a vetted library.
⚠️ **MITM on first contact** — you must compare safety numbers out-of-band (the app exposes `safetyNumberWithPeer`; a UI to display it is a natural next step). Without that, an attacker who controls the prekey distribution could substitute keys.
⚠️ **Compromised endpoint** — if the device is rooted/jailbroken with the keychain unlocked, all bets are off.
⚠️ **Your sent-message history is protected by your password** (see above) — weaker than the rest of the design if your password is weak.
⚠️ **Metadata** — who talks to whom, when, and how often is visible to the server (as with Signal).
⚠️ **No deniability guarantees** beyond what the primitives give.
⚠️ **Key verification UI** is not wired into a screen yet — the function exists, the button doesn't.
⚠️ **Side channels / fuzzing** — no constant-time guarantees beyond `constantTimeEqual`, and no fuzz testing.

## Testing

| Command | What it covers |
|---|---|
| `npm run check` | type-check of the crypto, utils, types and theme layers (`tsconfig.check.json`) |
| `npm run typecheck` | full-project type-check |
| `npm run test:crypto` | `crypto/__tests__/run.ts` (24 protocol tests) + `recovery.ts` (missing prekeys, reinstalls, glare, replay, Unicode) |
| `npm run test:services` | users, chats, messages, receipts, outbox, resend, history backup, pagination — the real service code against an in-memory Firestore (`services/__tests__/`) |
| `npm run test:components` | message bubble, ticks, error banner, avatar (jest-expo) |

`run.ts` drives two independent `SessionManager`s through: X3DH handshake + first message, reply (DH ratchet step), unique ciphertexts, out-of-order delivery, tamper detection, safety-number agreement, and persistence across restart.
