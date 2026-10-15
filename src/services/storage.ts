/**
 * Encrypted media.
 *
 * Media is encrypted on the device with a random per-file key *before* it is
 * uploaded, so the storage only ever holds ciphertext. The key travels inside
 * the end-to-end encrypted message body, so the server never sees it.
 *
 * Where it is stored changed, not how it is protected. This used to be Firebase
 * Storage, which now requires the Blaze plan; it is now Backblaze B2 through the
 * Worker. The encryption, the descriptor, the integrity check and the message
 * format are all unchanged — only the transport differs. Both directions go
 * through the Worker, which holds the B2 credentials, so the app needs no
 * storage secret of its own.
 *
 * Media message body format (the E2EE plaintext):
 *   { "__media": true, "key": "<base64>", "caption": "<text>" }
 *
 * Two behaviours here exist to make media feel like a normal messenger rather
 * than a web form:
 *
 *   - Everything decrypted is kept in a local cache keyed by the file's hash, so
 *     a photo opens instantly the second time and never re-downloads.
 *   - Our own sends are cached the moment they are sealed, so the sender sees
 *     their own photo immediately and permanently, without a round trip.
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

/** Where a decrypted file lives once we have it. Keyed by content hash. */
const CACHE_DIR = `${FileSystem.cacheDirectory}media/`;

function cachePathFor(descriptor: MediaDescriptor): string {
  // The hash is of the *plaintext*, so a file is stored under the same name on
  // every device and a re-open is a local read, not a download.
  return `${CACHE_DIR}${descriptor.sha256}${extensionFor(descriptor.mimeType)}`;
}

/** Ensure the cache directory exists. Cheap and idempotent. */
async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

/** The cached path for a descriptor if we already hold it, else null. */
export async function cachedMediaUri(descriptor: MediaDescriptor): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(cachePathFor(descriptor));
    return info.exists ? cachePathFor(descriptor) : null;
  } catch {
    return null;
  }
}

export interface UploadedMedia {
  descriptor: MediaDescriptor;
  /** base64 key to embed in the E2EE message body. */
  key: string;
}

export type ProgressFn = (fraction: number) => void;

export async function encryptAndUpload(
  uri: string,
  chatId: string,
  mimeType: string,
  extra: Partial<Pick<MediaDescriptor, 'width' | 'height' | 'durationMs' | 'fileName'>> = {},
  onProgress?: ProgressFn,
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

  const descriptor: MediaDescriptor = {
    storagePath: path,
    nonce: b64(sealed.nonce),
    sha256: sha256Hex(plaintext),
    mimeType,
    size: plaintext.length,
    ...extra,
  };

  // Cache our own copy before uploading, so the sender sees the photo at once
  // and keeps it even if the upload is slow or the app is restarted. This is
  // what makes sending feel instant instead of waiting on the network.
  await ensureCacheDir();
  try {
    await FileSystem.writeAsStringAsync(cachePathFor(descriptor), b64(plaintext), {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    log.warn('could not cache our own copy', e);
  }

  // The sealed bytes go to a temp file so the upload can report progress; a
  // raw fetch() gives no signal at all, which is why a large photo used to look
  // like nothing was happening.
  const uploadUri = `${FileSystem.cacheDirectory}${randomId(8)}.upload`;
  await FileSystem.writeAsStringAsync(uploadUri, b64(sealed.ciphertext), {
    encoding: FileSystem.EncodingType.Base64,
  });

  try {
    const task = FileSystem.createUploadTask(
      `${WORKER_BASE_URL}/media/${path}`,
      uploadUri,
      {
        httpMethod: 'PUT',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${idToken}`,
        },
      },
      (progress) => {
        const total = progress.totalBytesExpectedToSend || sealed.ciphertext.length;
        onProgress?.(total > 0 ? Math.min(1, progress.totalBytesSent / total) : 0);
      },
    );
    const result = await task.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      const detail = result?.body ? `: ${result.body.slice(0, 160)}` : '';
      throw new Error(`media upload failed (${result?.status ?? 'no response'})${detail}`);
    }
  } finally {
    // The temp file holds ciphertext, but there is no reason to leave it around.
    await FileSystem.deleteAsync(uploadUri, { idempotent: true }).catch(() => undefined);
  }

  onProgress?.(1);
  log.info(`uploaded encrypted media ${path} (${plaintext.length} bytes)`);
  return { descriptor, key: b64(key) };
}

/**
 * Download and decrypt media, returning a local file:// uri ready to render.
 *
 * Checks the cache first, so the second open of a photo is instant and offline.
 * Verifies the SHA-256 so a corrupted or tampered blob is rejected.
 */
export async function downloadAndDecrypt(
  descriptor: MediaDescriptor,
  keyB64: string,
  onProgress?: ProgressFn,
): Promise<string> {
  const cached = await cachedMediaUri(descriptor);
  if (cached) {
    onProgress?.(1);
    return cached;
  }

  await ensureCacheDir();

  // Download the ciphertext to a file rather than into memory: it lets us report
  // progress, and it avoids holding several megabytes of base64 in JS memory on
  // a phone, which is what made large photos stutter or fail outright.
  const tempUri = `${FileSystem.cacheDirectory}${randomId(8)}.dl`;
  try {
    const resumable = FileSystem.createDownloadResumable(
      `${WORKER_BASE_URL}/media/${descriptor.storagePath}`,
      tempUri,
      {},
      (progress) => {
        const total = progress.totalBytesExpectedToWrite || descriptor.size || 0;
        onProgress?.(total > 0 ? Math.min(1, progress.totalBytesWritten / total) : 0);
      },
    );
    const result = await resumable.downloadAsync();
    if (!result || (result.status && (result.status < 200 || result.status >= 300))) {
      throw new Error(`media download failed (${result?.status ?? 'no response'})`);
    }

    const ciphertextB64 = await FileSystem.readAsStringAsync(tempUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const plaintext = open(
      { nonce: fromB64(descriptor.nonce), ciphertext: fromB64(ciphertextB64) },
      fromB64(keyB64),
    );
    if (!plaintext) throw new Error('media failed to decrypt (wrong key or tampered blob)');

    if (sha256Hex(plaintext) !== descriptor.sha256) {
      throw new Error('media integrity check failed');
    }

    const target = cachePathFor(descriptor);
    await FileSystem.writeAsStringAsync(target, b64(plaintext), {
      encoding: FileSystem.EncodingType.Base64,
    });
    onProgress?.(1);
    return target;
  } finally {
    await FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => undefined);
  }
}

/** Drop cached media, to reclaim space. Not wired to anything yet. */
export async function clearMediaCache(): Promise<void> {
  await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true }).catch(() => undefined);
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
