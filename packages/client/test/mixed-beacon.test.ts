import { G, initialDeck, makeRollShare, makeShare, reEncrypt, verifyRollShare } from '@bored-games/deck';
import { describe, expect, it } from 'vitest';
import { beaconDomain, beaconPosition, isRollPosition, rollOrigin } from '../src/mixed-beacon.ts';
import { ShareStore } from '../src/shares.ts';

const root = 'ab'.repeat(32),
  request = 'cd'.repeat(32);
const random = (n: number) => new Uint8Array(n).fill(37);
describe('mixed card and dice proof isolation', () => {
  it('keeps the first private card concealed while a roll with the same counter completes', () => {
    const store = new ShareStore(3),
      deck = initialDeck('sails', 25).map((ct) => reEncrypt(ct, G.multiply(15n), 11n));
    for (const [seat, secret] of [3n, 5n, 7n].entries()) {
      if (seat !== 0)
        store.add(
          seat,
          0,
          makeShare(
            secret,
            deck[0] as (typeof deck)[number],
            { rootId: root, deckId: 'sails', pos: 0 },
            random,
          ),
        );
      store.add(seat, beaconPosition(25, 0), makeRollShare(secret, beaconDomain(root, request), 0, random));
    }
    expect(store.covered(0)).toBe(false);
    expect(store.covered(0, 0)).toBe(true);
    expect(store.covered(25)).toBe(true);
    expect(store.has(0, 0)).toBe(false);
    expect(store.has(0, 25)).toBe(true);
  });
  it('rejects a same-counter contribution from a different requesting move', () => {
    const share = makeRollShare(3n, beaconDomain(root, request), 4, random);
    expect(verifyRollShare(G.multiply(3n), beaconDomain(root, request), 4, share)).toBe(true);
    expect(verifyRollShare(G.multiply(3n), beaconDomain(root, 'ef'.repeat(32)), 4, share)).toBe(false);
    expect(beaconPosition(0, 4)).toBe(4);
    expect(beaconDomain(root, null)).toBe(root);
    expect(() => beaconPosition(25, -1)).toThrow();
  });
  it('takes the origin from the current canonical history after a rollback', () => {
    const before = { rolls: [] },
      after = { rolls: [{ id: 0 }] };
    const read = (s: typeof after) => s.rolls;
    expect(rollOrigin(0, [{ id: request, before, after }], read)).toBe(request);
    expect(rollOrigin(0, [{ id: 'ef'.repeat(32), before, after }], read)).toBe('ef'.repeat(32));
    expect(rollOrigin(1, [{ id: request, before, after }], read)).toBe(null);
  });
});

describe('roll positions beside play-phase reshuffles (D087)', () => {
  it('fill only the slots no epoch card can take, and match the old positions while they fit', () => {
    // A 44-card deck reshuffles into 128·k + i with i < 44: rolls take 44–127, then 172–255, and so on.
    expect(beaconPosition(44, 0, 128)).toBe(44);
    expect(beaconPosition(44, 83, 128)).toBe(127);
    expect(beaconPosition(44, 84, 128)).toBe(172);
    expect(beaconPosition(44, 84 + 83, 128)).toBe(255);
    expect(beaconPosition(44, 168, 128)).toBe(300);
    for (let id = 0; id < 84; id++) expect(beaconPosition(44, id, 128)).toBe(beaconPosition(44, id));
    expect(isRollPosition(127, 44, 128)).toBe(true);
    expect(isRollPosition(128, 44, 128)).toBe(false);
    expect(isRollPosition(171, 44, 128)).toBe(false);
    expect(isRollPosition(172, 44, 128)).toBe(true);
    expect(isRollPosition(43, 44, 128)).toBe(false);
    // Without reshuffles nothing changes: every position from the deck size on is a roll's.
    expect(beaconPosition(25, 7)).toBe(32);
    expect(isRollPosition(25, 25, null)).toBe(true);
    expect(isRollPosition(24, 25, null)).toBe(false);
    expect(() => beaconPosition(128, 0, 128)).toThrow();
  });
});
