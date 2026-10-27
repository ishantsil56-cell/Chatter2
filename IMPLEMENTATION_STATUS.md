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
| Blocked-users list, block/unblock, report | Existing and verified | P0 | Private `users/{uid}/blocks` (owner-only read/write); block/unblock on profiles, list + unblock in Settings; blocked senders' messages hidden everywhere (client filter, incl. groups, never marked read); direct sends refused on BOTH sides — server rule when the recipient blocked the sender, client gates (ensureDirectChat + prepareMessage) when you blocked them; group sends unaffected. Reports are write-only docs (no admin console yet — stored, not acted on). Limits: block does not remove shared-group membership, hide your profile, or stop the content-free push (Worker does not check blocks yet) |
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
| React with emoji | Restored (item 1, 2026-10-27) | P0 | `reactions.ts` + `ReactionPicker` + summary row under bubbles; subcollection `messages/{id}/reactions/{uid}`, member-read / own-write rules; one reaction per user, same emoji twice removes it |
| Edit sent message (+ marker) | Restored (item 1, 2026-10-27) | P0 | `disappearing.editMessage` re-encrypts via the normal send path; 15-min window is client-enforced (`canEditMessage`); rules `senderEdit` carve-out (sender-only, exact field set) refuses edits of tombstoned messages |
| Delete for me (local-only) | Restored (item 1, 2026-10-27) | P0 | `localDeletes.ts`: per-device hidden set in AsyncStorage, loaded at bootstrap; never touches the shared document |
| Delete for everyone | Existing and verified | P0 | Sender-only tombstone, rules-enforced (`senderTombstone` carve-out): envelopes, history copy and media descriptor blanked, renders "This message was deleted", preview rewritten only if it was the newest message; confirm dialog already existed in ChatScreen; resend cannot resurrect tombstoned content. 48h window LANDED (item 1, 2026-10-27) as a client-side gate (`canDeleteForEveryone`); past the window only delete-for-me is offered, so old messages stay deletable locally |
| Pin / mute / star chats | Implemented (item 2, 2026-10-27) | P1 | Per-user `users/{uid}/chatPrefs/{chatId}` (owner-only rules) — never the shared chat doc, unlike the October version that pinned for everyone; long-press row sheet; pinned chats sort first; mute is respected by the Worker push relay (`mutedSkipped` in its summary) |
| Mark unread, archive (hide) | Implemented (item 2, 2026-10-27) | P1 | `hideChatForMe` exists (hide); mark-unread is a `chatPrefs.unread` override forcing the row badge and the tab count, cleared when the chat opens |
| Mute/unmute conversation | Implemented (item 2, 2026-10-27) | P1 | Row sheet toggle; Worker push relay skips muted chats per recipient; muted icon on the row |
| Image / voice / file messages | Existing and verified | P0 | Kinds `image`, `voice`, `file`; encrypted via B2/Worker |
| Video messages | Missing | P1 | No `video` kind |
| Stickers / GIFs | Missing | P2 | |
| Polls | Restored (item 1, 2026-10-27) | P1 | Kind `poll`; `PollCreateScreen` (2–12 options, multi-select, deadline); votes in `messages/{id}/votes/{uid}`, member-read / own-write rules; tally + percentage bars in `PollBubble`; closed polls refuse votes |
| Captions, multi-attach, progress, retry, cancel | Existing and verified | P1 | Media rewrite (instant own-copy, cache, progress) |
| Link detection / safe previews | Needs improvement | P1 | Not verified in `MessageBubble` |
| Date separators, unread divider | Existing and verified | P0 | `DaySeparator` |
| Search chats / messages / in-chat | Partial (item 2, 2026-10-27) | P1 | Chat-list search by name/@username already existed; in-chat search is a filtered view over what this device decrypted (text, poll questions, media captions) — the server cannot search encrypted content, so unloaded/never-decrypted messages are not searchable; no jump-to-message-in-context yet |

## Voice messages and calls

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Voice notes: record, playback, seek, speed | Existing and verified | P0/P1 | `expo-av` player; recent end-of-playback fixes |
| Voice / video calls | Missing (user-removed) | P1/P2 | **Blocked:** needs WebRTC SFU + TURN (see plan); user confirmed 2026-10-27 not to build calls or video calls |

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
| Broadcast lists, channels, communities, bots | Missing | P2/P3 | Phase 4+, after core is stable; user confirmed 2026-10-27 not to build channels |

## Status / stories, ephemeral

| Feature | Status | Priority | Evidence / note |
|---|---|---|---|
| Status / stories (24h) | Missing (user-removed) | P2 | Re-add only if user re-approves; user confirmed 2026-10-27 not to build Status |
| Disappearing messages | Restored (item 1, 2026-10-27) | P1 | Per-chat TTL (off / 24h / 7d / 90d) set from GroupInfo or the 1:1 profile; captured on each new message (`ephemeralTtlMs` + `expiresAt`); clients hide past `expiresAt` (re-filtered every minute while a chat is open). Server-side hard-delete still does not exist — expiry is client-side hiding, same as the October version; cache purge via `shouldPurgeLocally` is not wired yet |

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
