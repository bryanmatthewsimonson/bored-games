import { describe, expect, it } from 'vitest';
import { makeRollShare, rollPoint, rollSeed, verifyRollShare } from '../src/beacon.ts';
import { G } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import { seededRandom } from './util.ts';

const root = 'game-root';

describe('dice beacon', () => {
  const rnd = seededRandom('beacon');
  const x0 = randomScalar(rnd);
  const x1 = randomScalar(rnd);
  const X0 = G.multiply(x0);
  const X1 = G.multiply(x1);

  it('makes a deterministic share that verifies only for its seat, root and roll', () => {
    const a = makeRollShare(x0, root, 4, seededRandom('share'));
    const b = makeRollShare(x0, root, 4, seededRandom('share'));
    expect(a.D.equals(b.D) && a.c === b.c && a.s === b.s).toBe(true);
    expect(verifyRollShare(X0, root, 4, a)).toBe(true);
    expect(verifyRollShare(X1, root, 4, a)).toBe(false);
    expect(verifyRollShare(X0, root, 5, a)).toBe(false);
    expect(verifyRollShare(X0, 'other-root', 4, a)).toBe(false);
    expect(verifyRollShare(X0, root, 4, { ...a, D: a.D.add(G) })).toBe(false);
    expect(verifyRollShare(X0, root, -1, a)).toBe(false);
    expect(verifyRollShare(X0, '', 4, a)).toBe(false);
  });

  it('hashes compressed points in seat order, and a second proof of the same point does not change it', () => {
    const first = makeRollShare(x0, root, 0, rnd);
    const second = makeRollShare(x1, root, 0, rnd);
    const again = makeRollShare(x1, root, 0, seededRandom('fresh-proof'));
    expect(second.D.equals(again.D)).toBe(true);
    expect(second.c === again.c && second.s === again.s).toBe(false);
    const seed = rollSeed([first, second]);
    expect(rollSeed([first, again])).toEqual(seed);
    expect(rollSeed([second, first])).not.toEqual(seed);
    expect(() => rollSeed([])).toThrow(RangeError);
  });

  it('binds the point to the roll id', () => {
    expect(rollPoint(root, 0).equals(rollPoint(root, 0))).toBe(true);
    expect(rollPoint(root, 0).equals(rollPoint(root, 1))).toBe(false);
    expect(() => rollPoint('', 0)).toThrow(RangeError);
    expect(() => rollPoint(root, 1.5)).toThrow(RangeError);
  });
});
