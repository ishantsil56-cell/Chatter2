# SECURITY_NOTES.md — IRIS (Chatter2)

Companion to `docs/ARCHITECTURE.md` (which already documents the trust model and the
E2E design honestly). This file records the audit's security findings, what is
enforced where, and what must change. Audit date: 2026-10-27, remote `main` @ `d6feb21`.

## Threat model (from `docs/ARCHITECTURE.md`, confirmed in code)

- The device is the root of trust. Firebase, the Worker, and B2 are untrusted infra:
  they hold ciphertext, metadata (chat membership, presence, mentions), and encrypted blobs.
- The server CAN see: who talks to whom, when, message sizes, presence, who is mentioned.
  It CANNOT see: message text, media bytes, media keys (those travel inside E2EE envelopes).
- Push notifications are content-free ("New message") because the relay cannot decrypt.

## Encryption scope — read this before making claims

- Transport: TLS (Firebase SDKs, Worker fetch). **TLS is not E2EE.**
- At rest on device: private keys in Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`);
  sessions sealed with a keychain-held master key before AsyncStorage.
- E2E: custom X3DH + Double Ratchet implementation (`src/services/crypto/`) on
  `tweetnacl` + `@noble/hashes`. It passes its own 2-party test harness.
- **It has NOT been independently audited or fuzzed to libsignal standard.**
  README says this plainly. Do not advertise "audited end-to-end encryption".
  For production claims, migrate to a vetted library
  (e.g. `@privacyresearch/libsignal-protocol-typescript` or a native libsignal binding).
- No safety-number / fingerprint verification UI — users cannot currently verify a
  peer's identity key out of band. Add before any strong E2EE claim.
- Backups: history key is password-wrapped; a wrong password locks the user out of
  history (see `verifyPassword` in `auth.ts`). Document this to users before they rely on it.

## What the rules enforce (verified in `firestore.rules`, 160 lines)

- Chat read: member (or non-existent doc, for direct-chat lookup).
- Chat create: caller must include themselves in `memberIds`.
- Chat update: any member, except `lastReadAt` per-user may only move forward.
- Message create: member + `senderId == caller`.
- Message update: recipient's own receipt moving forward only, OR sender swapping
  envelopes (resend recovery).
- Message delete: sender only.
- Typing: member, own uid only.
- Resend requests: member; create/update as requester; delete as requester or sender.
- Default deny (`/{document=**}` → false).

## Gaps (fix in Phase 1, in order)

1. **Group admin not enforced — FIXED in repo (2026-10-27), live after console publish.**
   Chat-update rules now split by what changed: any member may move only their own
   cursor forward, refresh previews, hide for themselves, leave (self-removal only),
   or add members (collaborative by product intent, documented in GroupInfoScreen).
   Removing other members, promoting, renaming, and deleting the chat doc require an
   admin on chats that carry `adminIds` (all groups created by current clients do).
   Legacy chats without `adminIds` keep today's behaviour so old clients and old
   groups keep working — they stay permissive until recreated. Client checks in
   `chats.ts` mirror the rules (legacy-aware); `removeMember`'s old strict check
   wrongly blocked legacy groups and is fixed. Group system messages now use the
   acting member as `senderId` (the old literal `'system'` sender was rejected by
   the message-create rule, so group create/add/remove/leave notices failed).
2. **Any member can delete the chat doc.** Restrict to admins/owner.
3. **No block list.** Add `users/{uid}/blocks`; rules + client must hide blocked content
   from search, notifications, and cached screens.
4. **Delete-for-everyone has no time window.** Add 48h window (rules: compare
   `createdAt` to request time) + confirm dialog + tombstone.
5. **No rate limiting on writes.** Rules are the only gate. Consider Worker-side throttles
   for message creation if spam appears; do not rely on client-side checks.
6. **Avatar upload path unverified** (`users.ts` has no avatar/storage code in this audit).
   Confirm avatars don't bypass the storage rules before shipping profile changes.
7. **B2 media secrets unverified.** If the Cloudflare dashboard lacks `B2_KEY_ID` /
   `B2_APP_KEY` / `B2_BUCKET` / `B2_ENDPOINT`, media fails. Verify before Phase 2 media work.
8. **Firebase Storage rules are stale.** Storage moved to B2; `/media` rules no longer
   protect anything live. Either remove them or document them as legacy.

## Secrets hygiene (observed good, keep it that way)

- Repo holds only `config/google-services.json.example`; real config via repo secrets
  (`GOOGLE_SERVICES_JSON`, `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`) for CI.
- Worker secrets (`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, B2 keys) live in the
  Cloudflare dashboard, never in the repo.
- Never log message plaintext or keys (`logger` scope usage — keep auditing new code).
- Signing keystore: losing it means the app identity can never be updated — keep the
  backup the workflow file warns about.

## Privacy notes

- Mentions are stored in the clear on purpose (the push relay needs them). Document this.
- Presence / last-seen is denormalised on the user doc — visibility toggles must be
  enforced in rules, not just hidden in UI (Phase 2).
- System messages store `systemText` in the clear by design — never put user content in them.
- Notification previews must stay content-free while E2E holds.
