/*
 * Bech32 (BIP-173) for NIP-19 `npub` and `nsec`. Pure. Data is passed as bytes: encoding regroups bytes into
 * 5-bit words with zero padding, and decoding accepts only data whose padding is valid.
 */
import { bytesToHex, hexToBytes } from './hex.ts';

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values: readonly number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GEN[i] as number;
  }
  return chk;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >>> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

/** Regroup `from`-bit values into `to`-bit values. Returns null for invalid input or (unless `pad`) bad padding. */
function convertBits(data: readonly number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const v of data) {
    if (v < 0 || v >> from !== 0) return null;
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & max);
  } else if (bits >= from || acc !== 0) {
    return null;
  }
  return out;
}

export function bech32Encode(hrp: string, data: Uint8Array): string {
  const words = convertBits(Array.from(data), 8, 5, true) as number[];
  const mod = polymod([...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...checksum].map((w) => CHARSET[w]).join('')}`;
}

/** Null when the text is not valid bech32: mixed case, bad characters, bad checksum, too long, or bad padding. */
export function bech32Decode(text: string, limit = 90): { hrp: string; data: Uint8Array } | null {
  if (text.length > limit) return null;
  const lower = text.toLowerCase();
  if (text !== lower && text !== text.toUpperCase()) return null;
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) return null;
  const hrp = lower.slice(0, pos);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) return null;
  }
  const words: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const w = CHARSET.indexOf(ch);
    if (w < 0) return null;
    words.push(w);
  }
  if (polymod([...hrpExpand(hrp), ...words]) !== 1) return null;
  const bytes = convertBits(words.slice(0, -6), 5, 8, false);
  return bytes === null ? null : { hrp, data: Uint8Array.from(bytes) };
}

function encodeKey(hrp: 'npub' | 'nsec', hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new RangeError('expected 64 lowercase hex characters');
  return bech32Encode(hrp, hexToBytes(hex));
}

export const npubEncode = (pubkeyHex: string): string => encodeKey('npub', pubkeyHex);
export const nsecEncode = (secretKeyHex: string): string => encodeKey('nsec', secretKeyHex);

/** Decode an `npub1…` or `nsec1…` string to hex. Null for anything else. */
export function decodeNostrKey(text: string): { type: 'npub' | 'nsec'; hex: string } | null {
  const d = bech32Decode(text.trim());
  if (d === null || (d.hrp !== 'npub' && d.hrp !== 'nsec') || d.data.length !== 32) return null;
  return { type: d.hrp, hex: bytesToHex(d.data) };
}

/** `npub1abcd…wxyz`, for display in tight spaces. */
export function shortNpub(npub: string): string {
  return npub.length <= 20 ? npub : `${npub.slice(0, 10)}…${npub.slice(-6)}`;
}
