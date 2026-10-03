/**
 * Shared domain types.
 *
 * Firestore layout (see docs/ARCHITECTURE.md):
 *   users/{uid}
 *   users/{uid}/prekeys/{keyId}          // public prekeys, published by the owner
 *   users/{uid}/private/prekeys          // NEVER synced; only referenced locally
 *   chats/{chatId}
 *   chats/{chatId}/messages/{messageId}
 *   users/{uid}/devices/{deviceId}
 *
 * Message bodies are end-to-end encrypted. The fields below named `ciphertext`
 * hold an opaque base64 blob that only the recipient can decrypt.
 */

export type UserId = string;
export type ChatId = string;
export type MessageId = string;

export interface UserProfile {
  uid: UserId;
  /** Email address from the Google account. */
  email: string;
  /** Unique, lower-case handle used to find people, e.g. "ishant". */
  username: string;
  displayName: string;
  about: string;
  photoURL: string | null;
  /** E2EE identity public key (Curve25519, base64). */
  identityKey: string;
  /** Ed25519 public key used to verify the signed prekey. */
  signingKey: string;
  /** Signed prekey + signature so peers can trust it. */
  signedPreKey: string;
  signedPreKeySignature: string;
  /** Monotonic counter of the last uploaded prekey batch. */
  preKeyId: number;
  createdAt: number;
  updatedAt: number;
  /** Denormalised presence, written by Cloud Functions / heartbeat. */
  presence?: PresenceState;
}

export interface PresenceState {
  online: boolean;
  lastSeen: number;
}

export type MessageKind = 'text' | 'image' | 'voice' | 'file' | 'system';

export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/**
 * A message as stored in Firestore.
 *
 * `envelopes` holds one encrypted copy per member (including the sender, so the
 * sender's own devices can re-read history after a reinstall). Each envelope is
 * opaque to the server. `system` messages carry no user content, so they store
 * their `systemText` in the clear.
 */
export interface Message {
  id: MessageId;
  chatId: ChatId;
  senderId: UserId;
  kind: MessageKind;

  /** Per-member encrypted payloads, keyed by recipient uid. */
  envelopes: Record<UserId, CipherEnvelope>;
  /** Non-secret media descriptor (URL + dimensions/duration); the media bytes
   *  are themselves encrypted before upload, so the URL leaks no content. */
  media?: MediaDescriptor | null;
  /** Only for `kind: 'system'`. */
  systemText?: string | null;

  createdAt: number;
  /** Per-recipient delivery/read receipts. */
  receipts: Record<UserId, MessageStatus>;
  /** Set by the sender's client so it can reconcile the optimistic local copy. */
  clientId: string;
}

/** One recipient's copy of an encrypted message. */
export interface CipherEnvelope {
  ciphertext: string;
  header: CipherHeader;
}

/** Everything a recipient needs (besides their own private keys) to decrypt. */
export interface CipherHeader {
  /** Sender's current ratchet public key (base64). */
  ratchetKey: string;
  /** Message number within the current sending chain. */
  counter: number;
  /** Number of messages in the previous sending chain. */
  previousCounter: number;
  /** XSalsa20-Poly1305 nonce for this message (base64). */
  nonce: string;
  /** The X3DH ephemeral public key — only present on the first message. */
  ephemeralKey?: string | null;
  /** Which of the sender's one-time prekeys was consumed (first message only). */
  usedPreKeyId?: number | null;
}

export interface MediaDescriptor {
  /** Storage path of the *encrypted* blob. */
  storagePath: string;
  /** base64 nonce used to encrypt the blob. */
  nonce: string;
  /** base64 SHA-256 of the plaintext, verified after decryption. */
  sha256: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  durationMs?: number;
  fileName?: string;
}

export type ChatKind = 'direct' | 'group';

export interface Chat {
  id: ChatId;
  kind: ChatKind;
  /** For groups: the human name. For direct chats: derived from the peer. */
  name: string | null;
  photoURL: string | null;
  /** Group chats only. */
  createdBy?: UserId;
  memberIds: UserId[];
  /** Denormalised per-member read cursor, so unread counts are cheap. */
  lastReadAt: Record<UserId, number>;
  /** Preview of the last message (text previews are also E2EE, so this holds a
   *  placeholder like "Message" or "Photo" plus a timestamp). */
  lastMessageAt: number;
  lastMessagePreview: string;
  /** Group admins may add/remove members. */
  adminIds?: UserId[];
  createdAt: number;
  updatedAt: number;
}

/** A decrypted message, ready for rendering. */
export interface DecryptedMessage extends Message {
  text: string | null;
  decrypted: boolean;
  /** Local-only: true while the optimistic copy has no server id yet. */
  pending?: boolean;
}

export interface DeviceToken {
  deviceId: string;
  fcmToken: string;
  platform: 'android' | 'ios';
  updatedAt: number;
}

/** A contact as shown in the "new chat" picker. */
export interface Contact {
  uid: UserId;
  displayName: string;
  username: string;
  email: string;
  photoURL: string | null;
}
