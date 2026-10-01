/** Lowercase hex helpers. Pure. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Strict: even length, lowercase `[0-9a-f]` only. Throws a `RangeError` otherwise. */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new RangeError('not lowercase even-length hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function isHex(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length % 2 === 0 && /^[0-9a-f]+$/.test(s);
}
