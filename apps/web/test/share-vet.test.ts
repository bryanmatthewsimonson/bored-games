/*
 * The pure parts of vetting saved Luster reveals (D056, audit-luster F3) and of deterministic automatic builds
 * (D059 item 2, audit-bank F3).
 */
import { finalizeEvent, sharesTemplate } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { deterministicRandom, hmacSha256, seatStreamKey } from '../src/det-random.ts';
import { bytesToHex, hexToBytes } from '../src/hex.ts';
import { ownCardReason, sharePositions, shareVerdict } from '../src/share-vet.ts';

const dealt = [
  { pos: 3, to: null },
  { pos: 41, to: 1 },
  { pos: 7, to: 0 },
];
const vet = (over: Partial<Parameters<typeof shareVerdict>[0]>) =>
  shareVerdict({ positions: [3], mySeat: 0, dealt, owed: [3], sentElsewhere: () => false, ...over });

describe('vetting a saved Shares event', () => {
  it('sends a reveal still owed on the current head', () => {
    expect(vet({})).toBe('send');
    expect(vet({ positions: [3, 41], owed: [3, 41, 50] })).toBe('send');
    expect(vet({ owed: null })).toBe('send');
  });
  it("never sends a share of this seat's own private card", () => {
    expect(vet({ positions: [7], owed: [7] })).toBe('it would reveal your own private card');
    expect(vet({ positions: [3, 7], owed: null })).toBe('it would reveal your own private card');
    expect(ownCardReason([7], 0, dealt)).not.toBeNull();
    expect(ownCardReason([7], null, dealt)).toBeNull();
    expect(ownCardReason([41], 0, dealt)).toBeNull();
  });
  it('discards one whose card is not drawn on the current head, or no longer owed', () => {
    expect(vet({ positions: [9] })).toMatch(/not drawn/);
    expect(vet({ owed: [] })).toBe('that card reveal is no longer owed');
    expect(vet({ owed: null, sentElsewhere: (p) => p === 3 })).toMatch(/another device/);
    expect(vet({ positions: [] })).toBe('it carries no card');
  });
  it('reads the positions of a Shares event, or null for anything else', () => {
    const sk = hexToBytes('11'.repeat(32));
    const rnd = (n: number) => new Uint8Array(n).fill(7);
    const ev = finalizeEvent(sharesTemplate({ rootId: 'ab'.repeat(32), shares: [] }, 1), sk, rnd);
    expect(sharePositions(ev)).toEqual([]);
    expect(sharePositions({ ...ev, kind: 1 })).toBeNull();
  });
});

describe('deterministic build streams', () => {
  it('HMAC-SHA256 matches RFC 4231 test case 2', () => {
    const mac = hmacSha256(
      new TextEncoder().encode('Jefe'),
      new TextEncoder().encode('what do ya want for nothing?'),
    );
    expect(bytesToHex(mac)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
  it('the same key and label give the same bytes however they are drawn; anything else differs', () => {
    const key = seatStreamKey(hexToBytes('22'.repeat(32)), 12345n);
    const a = deterministicRandom(key, 'root:beacon:head');
    const b = deterministicRandom(key, 'root:beacon:head');
    const first = bytesToHex(a(50));
    expect(bytesToHex(b(10)) + bytesToHex(b(40))).toBe(first);
    expect(bytesToHex(deterministicRandom(key, 'root:beacon:other')(50))).not.toBe(first);
    const other = seatStreamKey(hexToBytes('22'.repeat(32)), 12346n);
    expect(bytesToHex(deterministicRandom(other, 'root:beacon:head')(50))).not.toBe(first);
    expect(bytesToHex(seatStreamKey(hexToBytes('23'.repeat(32)), 12345n))).not.toBe(bytesToHex(key));
  });
});
