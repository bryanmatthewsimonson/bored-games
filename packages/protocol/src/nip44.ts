/*
 * NIP-44 version 2 encrypted payloads (https://github.com/nostr-protocol/nips/blob/master/44.md), used for the
 * player's encrypted self-backup of a seat's game keys (PROTOCOL §3, D065). Pure: the 32-byte nonce is passed in.
 *
 * - conversation key: HKDF-extract(IKM = the unhashed 32-byte x of the ECDH point, salt = "nip44-v2")
 * - message keys: HKDF-expand(conversation key, info = nonce, 76) → ChaCha20 key (32), ChaCha20 nonce (12), HMAC key (32)
 * - padded plaintext: u16 big-endian length, the UTF-8 plaintext, zeros up to `calcPaddedLen`
 * - payload: base64(0x02 ‖ nonce ‖ ChaCha20(padded) ‖ HMAC-SHA256(hmac key, nonce ‖ ciphertext))
 *
 * ChaCha20 (RFC 8439, 20 rounds, counter 0) is implemented here rather than adding a cipher dependency; the official
 * NIP-44 vectors (test/vectors/nip44.vectors.json) pin it, with the HKDF, HMAC and padding around it.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const SALT = utf8ToBytes('nip44-v2');
const MIN_PLAINTEXT = 1;
const MAX_PLAINTEXT = 65535;

/** The NIP-44 conversation key between secret key `sk` and the x-only public key `pubHex` (64 hex characters). */
export function getConversationKey(sk: Uint8Array, pubHex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(pubHex)) throw new Error('invalid public key');
  const shared = secp256k1.getSharedSecret(sk, hexToBytes(`02${pubHex}`), true);
  return extract(sha256, shared.subarray(1, 33), SALT);
}

/** The ChaCha20 key, nonce and HMAC key for one message. */
export function getMessageKeys(
  conversationKey: Uint8Array,
  nonce: Uint8Array,
): { chachaKey: Uint8Array; chachaNonce: Uint8Array; hmacKey: Uint8Array } {
  if (conversationKey.length !== 32) throw new Error('invalid conversation key length');
  if (nonce.length !== 32) throw new Error('invalid nonce length');
  const keys = expand(sha256, conversationKey, nonce, 76);
  return {
    chachaKey: keys.subarray(0, 32),
    chachaNonce: keys.subarray(32, 44),
    hmacKey: keys.subarray(44, 76),
  };
}

/** The padded length of a plaintext of `len` bytes (1 to 65535). */
export function calcPaddedLen(len: number): number {
  if (!Number.isSafeInteger(len) || len < 1) throw new Error('expected a positive integer');
  if (len <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(len - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((len - 1) / chunk) + 1);
}

function pad(plaintext: string): Uint8Array {
  const bytes = utf8ToBytes(plaintext);
  const len = bytes.length;
  if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT)
    throw new Error('invalid plaintext length: must be 1 to 65535 bytes');
  const out = new Uint8Array(2 + calcPaddedLen(len));
  out[0] = len >> 8;
  out[1] = len & 0xff;
  out.set(bytes, 2);
  return out;
}

/**
 * Strict UTF-8 decoding: the text must re-encode to exactly `bytes`, which rejects overlong forms, surrogates,
 * truncated sequences and stray continuation bytes (the base lib has no `TextDecoder` type here).
 */
export function utf8Decode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; ) {
    const c = bytes[i] as number;
    const n = c < 0x80 ? 1 : c >> 5 === 6 ? 2 : c >> 4 === 14 ? 3 : c >> 3 === 30 ? 4 : 0;
    if (n === 0 || i + n > bytes.length) throw new Error('invalid UTF-8');
    let cp = n === 1 ? c : c & (0xff >> (n + 1));
    for (let j = 1; j < n; j++) {
      const k = bytes[i + j] as number;
      if (k >> 6 !== 2) throw new Error('invalid UTF-8');
      cp = (cp << 6) | (k & 63);
    }
    if (cp > 0x10ffff) throw new Error('invalid UTF-8');
    s += String.fromCodePoint(cp);
    i += n;
  }
  const back = utf8ToBytes(s);
  if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error('invalid UTF-8');
  return s;
}

function unpad(padded: Uint8Array): string {
  const len = ((padded[0] ?? 0) << 8) | (padded[1] ?? 0);
  if (len < MIN_PLAINTEXT || len > MAX_PLAINTEXT || padded.length !== 2 + calcPaddedLen(len))
    throw new Error('invalid padding');
  return utf8Decode(padded.subarray(2, 2 + len));
}

/* ChaCha20 (RFC 8439 §2.3–2.4): the block function and the stream cipher with a 32-bit counter. */

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function quarter(s: Uint32Array, a: number, b: number, c: number, d: number): void {
  let A = s[a] as number;
  let B = s[b] as number;
  let C = s[c] as number;
  let D = s[d] as number;
  A = (A + B) >>> 0;
  D = rotl(D ^ A, 16);
  C = (C + D) >>> 0;
  B = rotl(B ^ C, 12);
  A = (A + B) >>> 0;
  D = rotl(D ^ A, 8);
  C = (C + D) >>> 0;
  B = rotl(B ^ C, 7);
  s[a] = A;
  s[b] = B;
  s[c] = C;
  s[d] = D;
}

function word(bytes: Uint8Array, i: number): number {
  return (
    ((bytes[i] as number) |
      ((bytes[i + 1] as number) << 8) |
      ((bytes[i + 2] as number) << 16) |
      ((bytes[i + 3] as number) << 24)) >>>
    0
  );
}

/** XOR `data` with the ChaCha20 keystream of `key` (32 bytes) and `nonce` (12 bytes), from block `counter`. */
export function chacha20(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, counter = 0): Uint8Array {
  if (key.length !== 32) throw new Error('invalid ChaCha20 key length');
  if (nonce.length !== 12) throw new Error('invalid ChaCha20 nonce length');
  const init = new Uint32Array(16);
  init[0] = 0x61707865;
  init[1] = 0x3320646e;
  init[2] = 0x79622d32;
  init[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) init[4 + i] = word(key, 4 * i);
  for (let i = 0; i < 3; i++) init[13 + i] = word(nonce, 4 * i);
  const out = new Uint8Array(data.length);
  const s = new Uint32Array(16);
  for (let off = 0, block = counter; off < data.length; off += 64, block++) {
    if (block > 0xffffffff) throw new Error('ChaCha20 counter overflow');
    init[12] = block;
    s.set(init);
    for (let r = 0; r < 10; r++) {
      quarter(s, 0, 4, 8, 12);
      quarter(s, 1, 5, 9, 13);
      quarter(s, 2, 6, 10, 14);
      quarter(s, 3, 7, 11, 15);
      quarter(s, 0, 5, 10, 15);
      quarter(s, 1, 6, 11, 12);
      quarter(s, 2, 7, 8, 13);
      quarter(s, 3, 4, 9, 14);
    }
    for (let i = 0; i < 16 && off + 4 * i < data.length; i++) {
      const k = ((s[i] as number) + (init[i] as number)) >>> 0;
      for (let j = 0; j < 4; j++) {
        const p = off + 4 * i + j;
        if (p >= data.length) break;
        out[p] = (data[p] as number) ^ ((k >>> (8 * j)) & 0xff);
      }
    }
  }
  return out;
}

/* Base64 (RFC 4648 §4, with padding), strict on decode. */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += b === undefined ? '=' : B64[(n >> 6) & 63];
    out += c === undefined ? '=' : B64[n & 63];
  }
  return out;
}

export function base64Decode(text: string): Uint8Array {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error('invalid base64');
  const pads = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - pads);
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const ch = text[i + j] as string;
      n = (n << 6) | (ch === '=' ? 0 : B64.indexOf(ch));
    }
    const bytes = [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    for (const byte of bytes) if (o < out.length) out[o++] = byte;
  }
  // Canonical only: re-encoding must give the same text (no stray bits under the padding).
  if (base64Encode(out) !== text) throw new Error('invalid base64');
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number);
  return diff === 0;
}

/** Encrypt `plaintext` (1 to 65535 UTF-8 bytes) under `conversationKey` with the 32-byte `nonce`. */
export function nip44Encrypt(plaintext: string, conversationKey: Uint8Array, nonce: Uint8Array): string {
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  const ciphertext = chacha20(chachaKey, chachaNonce, pad(plaintext));
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  return base64Encode(concatBytes(new Uint8Array([2]), nonce, ciphertext, mac));
}

/**
 * Whether `payload` has the exact shape of a NIP-44 v2 payload of a `plaintextBytes`-byte plaintext: canonical
 * base64 of version 2, a 32-byte nonce, the padded ciphertext and a 32-byte MAC. A check on what an untrusted encryptor
 * (a browser extension) returned, before it is published; it cannot see the MAC's key.
 */
export function isNip44Payload(payload: unknown, plaintextBytes: number): boolean {
  if (typeof payload !== 'string' || payload.length < 132 || payload.length > 87472) return false;
  if (
    !Number.isSafeInteger(plaintextBytes) ||
    plaintextBytes < MIN_PLAINTEXT ||
    plaintextBytes > MAX_PLAINTEXT
  )
    return false;
  let data: Uint8Array;
  try {
    data = base64Decode(payload);
  } catch {
    return false;
  }
  return data[0] === 2 && data.length === 1 + 32 + 2 + calcPaddedLen(plaintextBytes) + 32;
}

/** Decrypt a NIP-44 v2 payload; throws on any malformed, tampered or unsupported payload. */
export function nip44Decrypt(payload: string, conversationKey: Uint8Array): string {
  if (typeof payload !== 'string') throw new Error('invalid payload');
  const plen = payload.length;
  if (plen === 0 || payload[0] === '#') throw new Error('unknown encryption version');
  if (plen < 132 || plen > 87472) throw new Error('invalid payload length');
  const data = base64Decode(payload);
  const dlen = data.length;
  if (dlen < 99 || dlen > 65603) throw new Error('invalid data length');
  if (data[0] !== 2) throw new Error(`unknown encryption version ${data[0]}`);
  const nonce = data.subarray(1, 33);
  const ciphertext = data.subarray(33, dlen - 32);
  const mac = data.subarray(dlen - 32);
  const { chachaKey, chachaNonce, hmacKey } = getMessageKeys(conversationKey, nonce);
  if (!equalBytes(hmac(sha256, hmacKey, concatBytes(nonce, ciphertext)), mac)) throw new Error('invalid MAC');
  return unpad(chacha20(chachaKey, chachaNonce, ciphertext));
}
