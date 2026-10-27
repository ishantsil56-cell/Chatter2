# IRIS (Chatter2) — Implementation Audit

**Audited:** remote `main` @ `d6feb21` ("Bigger header, naked glowing eye…"), tags through `v1.0.109`.
**Auditor method:** read of the remote tree (no assumptions from earlier sessions). Local checkout
`~/workspace/chatter2` is 28 commits behind and was NOT used as evidence.
**Date:** 2026-10-27.

## 1. Current stack (verified, not assumed)

| Layer | Actual |
|---|---|
| App | React Native 0.74.5, Expo SDK 51, React 18.2, TypeScript 5.3, React Navigation 6, Zustand |
| Firebase | `@react-native-firebase` v20: Auth (email/password), Firestore, Messaging (FCM) |
| Crypto | Hand-rolled Signal-design X3DH + Double Ratchet on `tweetnacl` + `@noble/hashes` (`src/services/crypto/`) |
| Media | Encrypted on-device, stored in Backblaze B2 **through** the Cloudflare Worker (`src/services/storage.ts`) |
| Push | Cloudflare Worker `chatter2` (free plan, 1-minute cron, content-free FCM notifications) + `src/services/push.ts` |
| CI | `.github/workflows/build-apk.yml` → signed release APK → GitHub Release (Obtainium picks it up) |
| Tests | Jest (components), tsx harnesses (crypto 2-party, services). No E2E, no on-device test runs in this audit |

## 2. What already works (code-read verified, not device-tested)

- Email/password auth, username setup, profiles (display name, username, about, photo field)
- Contacts: saved contacts, username search, start direct chat
- Direct + group chats; group create, add/remove members, promote admin, rename, leave, hide
- E2E text / image / voice / file messages; replies; forwarding (`ForwardPicker`)
- Delivery + read receipts (rules enforce forward-only: sent → delivered → read)
- Typing indicators, presence, offline outbox with clientId deduplication, 50-message pagination
- Encrypted media with local hash cache, instant own-copy, progress, fullscreen viewer, zoom, voice player
- Undecryptable-message recovery via `resendRequests` (sender re-encrypts, no plaintext on server)
- History-key backup (`users/{uid}/backup`, `historyKey.ts`)
- Content-free push notifications (privacy-positive, ~1 minute delay by design)
- Error boundary, mockup-driven chat-list redesign (castle artwork header, per-person avatar gradients)

## 3. What is missing or regressed

**Regressed — present in Oct 15 v1.0.94, absent from remote `main` after commit
`bf7c7ff` ("Restore IRIS to the last known-good state"):**

- Reactions (`ReactionPicker`, `reactions.ts`, `useReactions`) — gone
- Polls (`PollBubble`, `PollCreateScreen`, `polls.ts`) — gone
- Disappearing messages (`disappearing.ts`, `DisappearingSettingRow`) — gone
- Edit message UI (`EditMessageSheet`) — gone (rules also block message edits: updates allow
  only receipt changes and sender resend envelopes)
- Delete-for-me, local-only (`localDeletes.ts`) — gone. Current `deleteMessage` hard-deletes
  the shared Firestore doc: sender-only per rules, no time window, no local-only option.
  Deleting a message deletes it for everyone, permanently.

**Missing (never present, or not found in this audit):**

- Pin / mute / star chats (no `pinChat`/`mute`/`star` in `chats.ts` exports; `hideChatForMe` exists)
- Message-text search, in-chat search
- Video messages (kinds are only `text | image | voice | file | system`)
- Stickers, GIFs
- Status / Stories — removed at user request Oct 15, still absent
- Voice / video calls — removed at user request Oct 15; needs WebRTC infra (see §5)
- Channels, broadcast lists, communities, bots, topics, folders
- Block list / block-unblock UI, report workflow (no blocks collection in rules)
- Privacy settings UI: no last-seen visibility, read-receipt opt-out, or profile-photo visibility
  toggles found in `SettingsScreen`
- Account deletion / data export workflow (backup doc exists; restore UX unverified)
- Multi-device session list / revoke UI (devices collection exists; management UI not verified)
- Avatar upload path not located in `users.ts` — verify before touching profiles
- Accessibility labels, text scaling, RTL, non-English strings — not verified

## 4. Highest-risk security / privacy issues

1. **Group admin is client-side only.** Chat-update rules let ANY member update the chat doc
   (only `lastReadAt` monotonicity is checked). `addMembers` / `promoteToAdmin` have no
   server-side admin check → any member can promote themselves or add anyone.
2. **Any member can delete the whole chat doc** (`allow delete: if isMember()` on `/chats/{id}`).
3. **Custom E2E crypto, unaudited.** README and `docs/ARCHITECTURE.md` are honest about this
   (recommend a vetted libsignal binding for production). Do not market the app as
   audited E2EE. No safety-number / fingerprint verification UI found.
4. **No block list** — no defence against unwanted contact or harassment.
5. **Media availability depends on Cloudflare dashboard secrets** (B2 key/bucket/endpoint).
   If unset, media sends fail; the KV fallback binding is deliberately commented out in
   `wrangler.toml`. Firebase Storage rules still exist but storage moved to B2 — dead rules
   and the avatar path need verification.
6. **Delete-for-everyone has no window and no confirmation verified** in the action sheet.
7. Password minimum length is 6 (Firebase floor). No brute-force protection beyond Firebase's.
8. Push notifications are content-free (good) but delayed up to ~1 minute (document, don't hide).

## 5. Server implementation — what exists, what is still needed

**Already exists (no new server needed for messaging):**

- Cloudflare Worker `chatter2`: push relay (FCM) + media proxy to Backblaze B2. Free tiers
  only (Cloudflare free, B2 10 GB free, FCM free, Firebase Spark). No card on file.
- Firestore + security rules cover text/media/groups/reactions/polls/disappearing — all of
  Phase 1 can be done with rules + client code, no new server.

**Still needed (new infra, needs approval before spending anything):**

- **Voice/video calls:** a WebRTC stack + TURN/STUN. Options: LiveKit Cloud (free tier,
  needs an account) or self-hosted SFU on a VPS (ongoing cost). Signalling alone (the old
  `services/calls` approach) is NOT real calls — the brief forbids simulated calls.
- **Server-enforced group admin:** can be done inside the EXISTING Worker (callable endpoint
  or stricter rules with an `adminIds` field) — no new server, just Worker + rules work.
- **Firebase Storage (Blaze plan):** only if media returns to Firebase Storage. Not needed
  while B2 works. Do not buy Blaze without verifying B2 first.

**Paid services: none required for Phase 1.** Calls are the only feature with a potential
bill, and it needs explicit approval first.

## 6. Test baseline

- `npm run test:crypto`, `npm run test:services`, `npm run test:components` exist.
- Not run in this audit: local checkout is stale and has no `node_modules`; device testing
  needs the CI APK or a dev-client build. Per the brief, tests run after each phase —
  nothing is marked passing until actually run.
