/**
 * Encrypted media.
 *
 * Media is encrypted on the device with a random per-file key *before* it is
 * uploaded, so the storage only ever holds ciphertext. The key travels inside
 * the end-to-end encrypted message body, so the server never sees it.
 *
 * Where it is stored changed, not how it is protected. This used to be Firebase
 * Storage, which now requires the Blaze plan; it is now Cloudflare Workers KV,
 * which is on the free plan and needs no card. The encryption, the descriptor,
 * the integrity check and the message format are all unchanged — only the two
 * transport calls below differ. Both directions go through the Worker, which
 * holds the KV binding, so the app needs no storage credential of its own.
 *
 * Media message body format (the E2EE plaintext):
 *   { "__media": true, "key": "<base64>", "caption": "<text>" }
 */

import * as FileSystem from 'expo-file-system';
import { auth } from './firebase';
import { WORKER_BASE_URL, MAX_MEDIA_BYTES } from '@/config';
import { randomId } from '@/utils/id';
import { b64, fromB64, randomBytes, seal, open, sha256Hex } from './crypto/primitives';
import type { MediaDescriptor } from '@/types';
import { scope } from '@/utils/logger';

const log = scope('media');

export interface MediaBody {
  __media: true;
  key: string;
  caption: string;
}

export function encodeMediaBody(keyB64: string, caption: string): string {
  const body: MediaBody = { __media: true, key: keyB64, caption };
  return JSON.stringify(body);
}

export function parseMediaBody(text: string | null): MediaBody | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Partial<MediaBody>;
    if (parsed.__media && typeof parsed.key === 'string') {
      return { __media: true, key: parsed.key, caption: parsed.caption ?? '' };
    }
  } catch {
    /* not a media body */
  }
  return null;
}

export interface UploadedMedia {
  descriptor: MediaDescriptor;
  /** base64 key to embed in the E2EE message body. */
  key: string;
}

export async function encryptAndUpload(
  uri: string,
  chatId: string,
  mimeType: string,
  extra: Partial<Pick<MediaDescriptor, 'width' | 'height' | 'durationMs' | 'fileName'>> = {},
): Promise<UploadedMedia> {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const plaintext = fromB64(base64);

  if (plaintext.length > MAX_MEDIA_BYTES) {
    throw new Error('that file is too large to send');
  }

  const key = randomBytes(32);
  const sealed = seal(plaintext, key);

  // The key is a random id, so the URL is unguessable — and the bytes behind it
  // are ciphertext anyway, so even a guessed URL yields nothing readable.
  const path = `media/${chatId}/${randomId(16)}.bin`;
  const idToken = await auth().currentUser?.getIdToken();
  if (!idToken) throw new Error('not signed in');

  const res = await fetch(`${WORKER_BASE_URL}/media/${path}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/octet-stream',
      authorization: `Bearer ${idToken}`,
    },
    // The sealed bytes, base64-decoded back to raw — the Worker stores exactly
    // what it is given and never inspects it.
    body: sealed.ciphertext,
  });
  if (!res.ok) {
    throw new Error(`media upload failed (${res.status})`);
  }

  const descriptor: MediaDescriptor = {
    storagePath: path,
    nonce: b64(sealed.nonce),
    sha256: sha256Hex(plaintext),
    mimeType,
    size: plaintext.length,
    ...extra,
  };
  log.info(`uploaded encrypted media ${path} (${plaintext.length} bytes)`);
  return { descriptor, key: b64(key) };
}

/**
 * Download and decrypt media, returning a local file:// uri ready to render.
 * Verifies the SHA-256 so a corrupted/tampered blob is rejected.
 */
export async function downloadAndDecrypt(descriptor: MediaDescriptor, keyB64: string): Promise<string> {
  const res = await fetch(`${WORKER_BASE_URL}/media/${descriptor.storagePath}`);
  if (!res.ok) throw new Error(`media download failed (${res.status})`);
  const ciphertext = new Uint8Array(await res.arrayBuffer());

  const plaintext = open({ nonce: fromB64(descriptor.nonce), ciphertext }, fromB64(keyB64));
  if (!plaintext) throw new Error('media failed to decrypt (wrong key or tampered blob)');

  if (sha256Hex(plaintext) !== descriptor.sha256) {
    throw new Error('media integrity check failed');
  }

  const ext = extensionFor(descriptor.mimeType);
  const localUri = `${FileSystem.cacheDirectory}${randomId(8)}${ext}`;
  await FileSystem.writeAsStringAsync(localUri, b64(plaintext), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return localUri;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('png')) return '.png';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return '.jpg';
  if (mimeType.includes('gif')) return '.gif';
  if (mimeType.includes('m4a') || mimeType.includes('aac')) return '.m4a';
  if (mimeType.includes('mp4')) return '.mp4';
  if (mimeType.includes('pdf')) return '.pdf';
  return '.bin';
}


