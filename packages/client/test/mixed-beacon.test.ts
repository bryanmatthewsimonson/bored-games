import { G, initialDeck, makeRollShare, makeShare, reEncrypt, verifyRollShare } from '@bored-games/deck';
import { describe, expect, it } from 'vitest';
import { beaconDomain, beaconPosition, rollOrigin } from '../src/mixed-beacon.ts';
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
