import * as nacl from 'tweetnacl';

/** Cryptographically-random hex id, used for chats, messages and clientIds. */
export function randomId(bytes = 16): string {
  const buf = nacl.randomBytes(bytes);
  return bytesToHex(buf);
}

/** A deterministic-ish id for direct chats: sorted uids joined. */
export function directChatId(a: string, b: string): string {
  return [a, b].sort().join('__');
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}
