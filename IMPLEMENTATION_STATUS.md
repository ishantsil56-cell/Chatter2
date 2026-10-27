# IMPLEMENTATION_STATUS.md — IRIS (Chatter2)

Audit date: 2026-10-27. Remote `main` @ `d6feb21`. Full evidence: `AUDIT.md`.
Status key: **Existing and verified** (code-read) · **Needs improvement** · **Missing** ·
**Blocked by platform/provider** · **Not applicable**. Nothing here is device-tested yet.

## Accounts, registration, identity

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Email/password sign-up + sign-in | Existing and verified | P0 | `src/services/auth.ts` (Firebase Auth) |
| Phone OTP sign-in | Not applicable | — | Product uses email auth; no SMS provider |
| Session persistence / sign-out | Existing and verified | P0 | Firebase Auth + `authStore` |
| Sign out other devices / revoke sessions | Missing | P1 | Devices collection exists; no management UI verified |
| Password reset email | Existing and verified | P0 | `auth.ts` |
| Profile: display name, username, about, photo field | Existing and verified | P0 | `UserProfile`, `ProfileScreen` |
| Avatar upload flow | Needs improvement | P0 | Path not located in `users.ts` — verify in Phase 1 |
| Profile visibility / last-seen / photo visibility settings | Missing | P1 | No toggles found in `SettingsScreen` |
| Blocked-users list, block/unblock, report | Missing | P0 | No blocks collection in rules |
| Account deletion / data export | Missing | P1 | Backup doc exists; delete/export workflow not found |
| Contacts: saved contacts, username search | Existing and verified | P0 | `useContacts`, `useSavedContacts` |
| Contact sync / invite links | Missing | P1 | No invite-link flow found |

## One-to-one messaging

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Real-time text, timestamps, stable ordering, receipts | Existing and verified | P0 | `messages.ts`, forward-only receipt rules |
| Offline queue + dedup | Existing and verified | P0 | `outbox.ts`, sender-chosen `clientId` |
| Retry failed, drafts | Needs improvement | P0 | Outbox exists; draft persistence not verified |
| Copy, select, forward (with picker) | Existing and verified | P0 | `ForwardPicker`, `ChatScreen` |
| Reply with quote | Existing and verified | P0 | `ReplyRef`, `decodeTextBody` |
| React with emoji | Missing (regressed) | P0 | Removed after `bf7c7ff` restore |
| Edit sent message (+ marker) | Missing (regressed) | P0 | UI gone; rules block message edits |
| Delete for me (local-only) | Missing (regressed) | P0 | `localDeletes.ts` gone; see below |
| Delete for everyone | Existing and verified | P0 | Sender-only tombstone, rules-enforced (`senderTombstone` carve-out): envelopes, history copy and media descriptor blanked, renders "This message was deleted", preview rewritten only if it was the newest message; confirm dialog already existed in ChatScreen; resend cannot resurrect tombstoned content. 48h window deferred until delete-for-me lands (needs the restore decision) so old messages never become undeletable |
| Pin / mute / star chats | Missing | P1 | `hideChatForMe` only |
| Mark unread, archive (hide) | Needs improvement | P1 | `hideChatForMe` exists; mark-unread not verified |
| Mute/unmute conversation | Missing | P1 | |
| Image / voice / file messages | Existing and verified | P0 | Kinds `image`, `voice`, `file`; encrypted via B2/Worker |
| Video messages | Missing | P1 | No `video` kind |
| Stickers / GIFs | Missing | P2 | |
| Polls | Missing (regressed) | P1 | Removed after `bf7c7ff` restore |
| Captions, multi-attach, progress, retry, cancel | Existing and verified | P1 | Media rewrite (instant own-copy, cache, progress) |
| Link detection / safe previews | Needs improvement | P1 | Not verified in `MessageBubble` |
| Date separators, unread divider | Existing and verified | P0 | `DaySeparator` |
| Search chats / messages / in-chat | Missing | P1 | No search UI found |

## Voice messages and calls

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Voice notes: record, playback, seek, speed | Existing and verified | P0/P1 | `expo-av` player; recent end-of-playback fixes |
| Voice / video calls | Missing (user-removed) | P1/P2 | **Blocked:** needs WebRTC SFU + TURN (see plan) |

## Groups

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Create group, name/photo, add/remove, leave, rename | Existing and verified | P0/P1 | `chats.ts`, `GroupCreateScreen`, `GroupInfoScreen` |
| Admin promote | Existing and verified | P1 | `promoteToAdmin` + rules: admin-only on chats with `adminIds`; legacy chats keep old behaviour (see SECURITY_NOTES) |
| Demote, ownership transfer | Missing | P1 | |
| Invite links, join approval | Missing | P1 | |
| Mentions (@username) | Existing and verified | P1 | `mentions` field (push relay uses it) |
| Group search, pinned messages, shared gallery | Missing | P1 | |
| Moderation / audit log | Missing | P1 | |

## Channels, broadcast, communities

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Broadcast lists, channels, communities, bots | Missing | P2/P3 | Phase 4+, after core is stable |

## Status / stories, ephemeral

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Status / stories (24h) | Missing (user-removed) | P2 | Re-add only if user re-approves |
| Disappearing messages | Missing (regressed) | P1 | Removed after `bf7c7ff` restore |

## Privacy and security

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| E2E encryption (Signal-design X3DH + ratchet) | Needs improvement | P0 | Works per tests; **custom, unaudited** — do not claim audited E2EE |
| Safety-number / fingerprint verification | Missing | P1 | |
| Server-side authz for sensitive ops | Existing and verified | P0 | Receipts, sender-delete, and now group admin (remove/promote/rename/chat-delete) enforced in rules — **live only after the new firestore.rules are published in the Firebase console**; group system messages fixed to use the acting member as sender (was `senderId: 'system'`, which the message-create rule rejects) |
| Encrypted media + local secure storage | Existing and verified | P0 | Keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), sealed sessions |
| Push privacy (content-free) | Existing and verified | P0 | Worker sends "New message" only |
| Disappearing / retention enforcement | Missing | P1 | Goes with disappearing messages |
| Rate limiting / abuse controls | Needs improvement | P1 | Rules only; no server rate limits |

## Notifications, presence, sync, backup

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Push notifications (FCM via Worker) | Existing and verified | P0 | ~1 min delay by design (cron granularity) |
| Mute-respecting notifications | Needs improvement | P0 | Mute itself is missing, so nothing to respect yet |
| Typing indicators, presence, last seen | Existing and verified | P1 | `useTyping`, `usePresence`, `typing/{uid}` rules |
| Multi-device envelopes + devices | Existing and verified | P1 | Per-member envelopes incl. sender |
| Backup / restore UX | Needs improvement | P1 | `users/{uid}/backup` + history key exist; restore flow unverified |
| Pagination (50/page), list virtualization | Existing and verified | P0 | `PAGE_SIZE = 50`, `messageCache` |

## Settings, performance, accessibility

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Settings screens (account/profile/chat) | Existing and verified | P0 | `SettingsScreen`, `ProfileScreen` |
| Light/dark/system theme | Existing and verified | P1 | Theme tokens + provider |
| Storage usage / cache cleanup | Missing | P1 | Media cache exists; no usage UI |
| Accessibility labels, text scaling, RTL | Needs improvement | P1 | Not verified in this audit |
| Localization (non-English strings) | Missing | P2 | English-only UI observed |

## Blocked / not applicable

- Phone OTP: not applicable (email-auth product).
- Calls: blocked until a WebRTC provider + TURN is approved (see `IMPLEMENTATION_PLAN.md`).
- Firebase Storage media path: superseded by B2/Worker (Blaze plan would be needed to go back).
