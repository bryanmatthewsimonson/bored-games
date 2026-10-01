import { describe, expect, it } from 'vitest';
import { bech32Decode, bech32Encode, decodeNostrKey, npubEncode, nsecEncode } from '../src/bech32.ts';

const NPUB = 'npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6';
const HEX = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

describe('bech32', () => {
  it('encodes the known npub vector', () => {
    expect(npubEncode(HEX)).toBe(NPUB);
  });

  it('decodes the known npub vector', () => {
    expect(decodeNostrKey(NPUB)).toEqual({ type: 'npub', hex: HEX });
  });

  it('round-trips an nsec', () => {
    const sk = '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa';
    const nsec = nsecEncode(sk);
    expect(nsec.startsWith('nsec1')).toBe(true);
    expect(decodeNostrKey(nsec)).toEqual({ type: 'nsec', hex: sk });
  });

  it('matches the BIP-173 valid test vectors', () => {
    for (const s of [
      'A12UEL5L',
      'a12uel5l',
      'an83characterlonghumanreadablepartthatcontainsthenumber1andtheexcludedcharactersbio1tt5tgs',
      'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
      '?1ezyfcl',
    ]) {
      // The longer vectors exceed the usual 90-character limit only in BIP-173's own examples.
      expect(bech32Decode(s, 1000)).not.toBeNull();
    }
  });

  it('decodes then re-encodes to the same text', () => {
    const d = bech32Decode('abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw');
    expect(d).not.toBeNull();
    if (d) expect(bech32Encode(d.hrp, d.data)).toBe('abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw');
  });

  it('rejects a bad checksum, mixed case, and a missing separator', () => {
    expect(bech32Decode(`${NPUB.slice(0, -1)}7`)).toBeNull();
    expect(bech32Decode(`N${NPUB.slice(1)}`)).toBeNull();
    expect(bech32Decode('nosep')).toBeNull();
    expect(bech32Decode('1pzry9x0s0muk')).toBeNull();
  });

  it('rejects the wrong prefix or length for a Nostr key', () => {
    expect(decodeNostrKey(nsecEncode(HEX))).toEqual({ type: 'nsec', hex: HEX });
    expect(decodeNostrKey('')).toBeNull();
    expect(decodeNostrKey(bech32Encode('nprofile', new Uint8Array(32)))).toBeNull();
    expect(decodeNostrKey(bech32Encode('npub', new Uint8Array(31)))).toBeNull();
  });

  it('rejects malformed hex when encoding', () => {
    expect(() => npubEncode('abcd')).toThrow(RangeError);
  });
});
