/**
 * Byte / string helpers.
 *
 * Everything here is self-contained on purpose. React Native (Hermes) does not
 * provide the browser/Node globals these operations usually rely on:
 *
 *   - no `TextEncoder` / `TextDecoder`
 *   - no `atob` / `btoa`
 *
 * So we implement UTF-8 and base64 ourselves. That also means the identical
 * code runs in React Native, Node (the test harness) and Cloud Functions, with
 * no polyfills and no platform branching.
 */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// --- UTF-8 -------------------------------------------------------------------

export function utf8ToBytes(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      // Surrogate pair -> code point above U+FFFF.
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f),
        );
        i++;
      } else {
        out.push(0xef, 0xbf, 0xbd); // lone surrogate -> replacement char
      }
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return new Uint8Array(out);
}

export function bytesToUtf8(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i] ?? 0;
    if (c < 0x80) {
      out += String.fromCharCode(c);
      i += 1;
    } else if (c >= 0xc0 && c < 0xe0 && i + 1 < b.length) {
      out += String.fromCharCode(((c & 0x1f) << 6) | ((b[i + 1] ?? 0) & 0x3f));
      i += 2;
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length) {
      out += String.fromCharCode(
        ((c & 0x0f) << 12) | (((b[i + 1] ?? 0) & 0x3f) << 6) | ((b[i + 2] ?? 0) & 0x3f),
      );
      i += 3;
    } else if (c >= 0xf0 && i + 3 < b.length) {
      let cp =
        ((c & 0x07) << 18) |
        (((b[i + 1] ?? 0) & 0x3f) << 12) |
        (((b[i + 2] ?? 0) & 0x3f) << 6) |
        ((b[i + 3] ?? 0) & 0x3f);
      cp -= 0x10000;
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      i += 4;
    } else {
      out += '\uFFFD';
      i += 1;
    }
  }
  return out;
}

// --- base64 ------------------------------------------------------------------

export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i] ?? 'A') << 18) |
      (B64.indexOf(clean[i + 1] ?? 'A') << 12) |
      (B64.indexOf(clean[i + 2] ?? 'A') << 6) |
      B64.indexOf(clean[i + 3] ?? 'A');
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63] ?? '';
    out += B64[(n >> 12) & 63] ?? '';
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] ?? '' : '=';
    out += i + 2 < bytes.length ? B64[n & 63] ?? '' : '=';
  }
  return out;
}

// --- misc --------------------------------------------------------------------

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Length-independent equality — use for MAC / key comparison, never `===`. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

export function toUint8(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}
