import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  createRng,
  cyrb53,
  fuzzBatch,
  fuzzGame,
  jsonEqual,
  range,
  replay,
  shuffle,
  stateHash,
} from '../src/index.ts';
import { createToy } from './toy.ts';

describe('canonicalJson', () => {
  it('sorts keys and is insensitive to insertion order', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: null }] })).toBe('{"a":[1,{"c":null,"d":2}],"b":1}');
    expect(jsonEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
  });

  it.each([
    ['undefined', { a: undefined }],
    ['NaN', { a: Number.NaN }],
    ['Infinity', [Number.POSITIVE_INFINITY]],
    ['negative zero', { a: -0 }],
    ['Map', { a: new Map() }],
    ['Set', [new Set()]],
    ['sparse array', Object.assign([1], { 2: 3 })],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJson(value)).toThrow(TypeError);
  });

  it('round-trips arbitrary JSON values', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        const once = canonicalJson(JSON.parse(JSON.stringify(v)));
        expect(canonicalJson(JSON.parse(once))).toBe(once);
      }),
    );
  });
});

describe('hash and prng', () => {
  it('hashes deterministically', () => {
    expect(cyrb53('abc')).toBe(cyrb53('abc'));
    expect(cyrb53('abc')).not.toBe(cyrb53('abd'));
    expect(stateHash({ a: 1, b: 2 })).toBe(stateHash({ b: 2, a: 1 }));
  });

  it('produces reproducible streams and fair-looking ints', () => {
    const a = createRng('seed');
    const b = createRng('seed');
    const xs = range(50).map(() => a.int(1000));
    expect(range(50).map(() => b.int(1000))).toEqual(xs);
    expect(createRng('other').int(1000000)).not.toBe(createRng('seed').int(1000000));
    const counts = [0, 0, 0];
    const r = createRng(7);
    for (let i = 0; i < 3000; i++) counts[r.int(3)] = (counts[r.int(3)] ?? 0) + 1;
    for (const c of counts) expect(c).toBeGreaterThan(800);
  });

  it('shuffles into a permutation', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 200 }), fc.string(), (n, seed) => {
        const out = shuffle(range(n), createRng(seed));
        expect(out.slice().sort((x, y) => x - y)).toEqual(range(n));
      }),
    );
  });
});

describe('fuzzer and replay on the toy module', () => {
  it('plays clean games with view consistency', () => {
    const toy = createToy();
    const report = fuzzBatch(toy, {
      seed: 'toy',
      games: 200,
      seatCounts: [2, 3, 4],
      rules: toy.defaultRules(),
    });
    expect(report.failures).toEqual([]);
    expect(report.games).toBe(200);
    expect(report.coverage['end:handsEmpty']).toBe(200);
    expect(report.coverage.playedTopCard).toBeGreaterThan(0);
  });

  it('replays a public log to the same state', () => {
    const toy = createToy();
    const rules = toy.defaultRules();
    const game = fuzzGame(toy, { seed: 'r', seats: 3, rules });
    expect(game.failure).toBeNull();
    const deckOrders = { cards: shuffle(range(12), createRng('r').fork('deck')) };
    const rep = replay(
      toy,
      { rules, seats: 3, mode: 'full', deckOrders },
      game.actions.map((action) => ({ kind: 'action', action })),
    );
    expect(rep.ok && stateHash(rep.state)).toBe(game.finalHash);
  });

  it('reports a game whose outcome the caller forbids', () => {
    const toy = createToy();
    const report = fuzzGame(toy, {
      seed: 'outcome',
      seats: 3,
      rules: toy.defaultRules(),
      checkOutcome: (o) => (o.reason === 'handsEmpty' ? 'games must not end by emptying hands' : null),
    });
    expect(report.failure?.message).toBe('forbidden outcome: games must not end by emptying hands');
  });

  it.each([
    ['mutate', /threw|Cannot assign/],
    ['invariant', /invariant: negative score/],
    ['nondeterministic', /view mismatch|replay produced a different final state/],
    ['acceptsImpostor', /seat that is not pending/],
    ['neverEnds', /no termination/],
  ] as const)('reports a %s bug with a reproducible seed', (bug, message) => {
    const toy = createToy({ bug });
    const report = fuzzBatch(toy, {
      seed: 'bug',
      games: 20,
      seatCounts: [3],
      rules: toy.defaultRules(),
      maxSteps: 200,
    });
    expect(report.failures.length).toBe(1);
    const failure = report.failures[0];
    expect(failure?.message).toMatch(message);
    if (bug !== 'nondeterministic') {
      const fresh = createToy({ bug });
      const again = fuzzGame(fresh, {
        seed: failure?.seed ?? '',
        seats: 3,
        rules: fresh.defaultRules(),
        maxSteps: 200,
      });
      expect(again.failure?.message).toBe(failure?.message);
    }
  });
});
