# IMPLEMENTATION_PLAN.md — IRIS (Chatter2)

Follows the brief's roadmap, adjusted after the 2026-10-27 audit (`AUDIT.md`).
Rule for every phase: implement, run typecheck + unit tests + CI APK build, fix
regressions before moving on. Nothing is marked complete without a test run.
No paid service is introduced without explicit approval.

## Phase 0 — Audit and safety (this delivery)

- [x] Repository + architecture audit (remote `main` @ `d6feb21`)
- [x] Feature inventory (`IMPLEMENTATION_STATUS.md`)
- [x] Auth / rules / storage / push review
- [x] Baseline: app builds via CI (`build-apk.yml`); tests exist but were NOT run here
      (local checkout is stale, no `node_modules`) — first Phase 1 step runs them
- [ ] **Blocking question (needs the user's answer before Phase 1 code):**
      polls, reactions, disappearing messages, edit, and delete-for-me were lost in
      commit `bf7c7ff` ("Restore IRIS to the last known-good state"). Were they
      deliberately discarded, or collateral of that rollback? Phase 1 restores them
      only on a yes.

Exit criteria: audit docs on `main`, blocking question answered.

## Phase 1 — Messaging foundation + restore (P0, no new server)

Scope: everything here is Firestore rules + client code. No new infrastructure.

1. **Server-enforced group admin (security fix, first).**
   Add `adminIds` to chat docs; rules: only admins may add/remove members, promote/demote,
   rename. Any member may still update `lastReadAt`. Restrict chat-doc delete to admins
   (or owner); today any member can delete the whole chat.
2. **Restore regressed features** (only on a yes to the Phase 0 question):
   reactions (+ rules subcollection), polls (+ votes subcollection), disappearing
   messages (per-chat timer + client + rules cleanup), edit message (sender-only, 15 min
   window, edited marker, rules allow sender envelope+marker change only),
   delete-for-me (local-only via AsyncStorage filter, never touching the shared doc).
3. **Delete-for-everyone hardening:** sender-only (already in rules), 48h window, confirm
   dialog, tombstone ("This message was deleted") instead of silent disappearance.
4. **Block list + report:** `users/{uid}/blocks` + rules; blocked users' messages hidden,
   blocked senders can't add you to groups; report writes a report doc (no message content
   in logs).
5. **Pin / mute / star chats; mark unread.** Per-user fields on a user-chat state doc
   (never on the shared chat doc — pinning must not pin for everyone).
6. **Message search:** chat-list search by name/username first; message-text search second
   (client-side over decrypted cache — the server cannot read content, so no server search).
7. **Verify before shipping:** avatar upload path, B2 secrets configured in Cloudflare
   (else media fails), `google-services.json` absent from repo, CI test step.

Acceptance (brief §21): items 1–12, 15, 17–19, verified on two accounts + CI APK.
Exit criteria: two accounts exchange persistent messages, reactions, polls, edits, deletes
and blocks behave per rules, and an unauthorized member cannot perform admin actions
(proven by a rules test, not just UI hiding).

## Phase 2 — Everyday messaging (P0/P1, no new server)

- Video messages (new `video` kind + rules + picker + compression + playback).
- Stickers: curated local packs first (no provider dependency); GIF search only if a
  provider is approved.
- Privacy settings UI: last-seen visibility, read-receipt opt-out, photo visibility,
  who-can-add-me-to-groups (rules must enforce each, not just the UI).
- Multi-device session list + revoke; backup/restore UX pass.
- Media gallery per chat (media/files/links tabs), storage usage + cache cleanup.
- Link previews (safe parsing, no arbitrary execution), drafts persistence.
- Accessibility pass: labels, text scaling, contrast; error/loading/empty/offline states
  on every new screen.

Exit criteria: §21 items 1–20 except calls; device tests on two accounts.

## Phase 3 — Groups and community basics (P1)

- Invite links (revocable), join approval, demote admin, ownership transfer rules.
- Group search, pinned messages, shared gallery, member-specific notifications.
- Moderation: remove/ban, report group, admin audit log (system messages).
- Slow mode for large groups (rules-enforced timestamp check).

Exit criteria: unauthorized users cannot join, read, post, or administer groups.

## Phase 4 — Calls and ephemeral media (P1/P2, NEEDS NEW INFRA — approval required)

- **Decision needed first:** provider (LiveKit Cloud free tier vs self-hosted SFU vs
  other) + TURN/STUN. Cost, quota, and privacy implications documented before integration.
- Voice/video 1:1 calls with real WebRTC (no simulated calls), call history, permissions,
  reconnection, push for incoming calls (Worker already supports FCM — extend, don't rebuild).
- Status/stories (24h, audience selection, server-side expiry) — ONLY if the user
  re-approves; he removed them in Oct 2026.
- Disappearing-message retention verification (attachments, indexes, quotes/forwards policy).

Exit criteria: calls work between real devices on real networks; retention verified.

## Phase 5 — Advanced (P2/P3, after core is stable)

- Channels, broadcast lists, communities, bots (permission model), topics, folders.
- Advanced search + moderation tooling, scheduled messages, drafts sync.
- Desktop/web companion (only if asked).

Exit criteria: each feature ships with security, performance, and operating-cost notes.

## Phase 6 — Release readiness

- Automated unit + integration tests; device tests on two accounts; weak-network tests.
- Security review (incl. crypto scope statement — unaudited custom E2EE vs vetted libsignal).
- Accessibility + performance review; migration/restore tests; crash monitoring.
- Privacy policy + data-retention review; release notes + known limitations.
- README refresh (setup, env, testing, deployment); `MIGRATIONS.md` if any schema changed.

## Dependencies

- Phase 1.1 (rules) blocks 1.2–1.5 (features that rely on rules).
- Phase 4 calls block on provider approval + TURN; nothing else blocks on it.
- B2 verification blocks media work in Phase 2 (if B2 is down, fix that first).
- `IMPLEMENTATION_STATUS.md` is updated at the end of every phase, with test evidence.
