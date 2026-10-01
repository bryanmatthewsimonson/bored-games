import { canonicalJson } from '@bored-games/game-kit';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { makeShare, verifyShare } from '../src/dleq.ts';
import { initialDeck, jointKey } from '../src/elgamal.ts';
import { b64u, encodePoint, encodeScalar, type Point } from '../src/encoding.ts';
import { G, q } from '../src/group.ts';
import { provePok, verifyPok } from '../src/pok.ts';
import { randomScalar } from '../src/random.ts';
import { proveShuffle, type ShuffleCtx, shuffleDeck, verifyShuffle } from '../src/shuffle.ts';
import {
  DeckWireError,
  decodeDeck,
  decodePok,
  decodeShare,
  decodeShuffleProof,
  encodeDeck,
  encodePok,
  encodeShare,
  encodeShuffleProof,
} from '../src/wire.ts';
import { seededRandom } from './util.ts';

const ZERO = secp256k1.Point.ZERO;
const P = secp256k1.Point.Fp.ORDER;
const DECK = 'tiles';

/* ----------------------------------------------------------------------------------------- fixtures */

function setup(n: number, seed: string) {
  const rnd = seededRandom(seed);
  const secrets = [randomScalar(rnd), randomScalar(rnd)];
  const X = jointKey(secrets.map((x) => G.multiply(x)));
  const input = initialDeck(DECK, n);
  const ctx: ShuffleCtx = { rootId: 'root', seat: 0, deckId: DECK };
  const { out, psi, rPrime } = shuffleDeck(input, X, rnd);
  const proof = proveShuffle(input, out, X, psi, rPrime, ctx, rnd);
  return { rnd, secrets, X, input, ctx, out, proof };
}

const N = 5;
const fx = setup(N, 'wire-1');
const wireProof = encodeShuffleProof(fx.proof);
const wireDeck = encodeDeck(fx.out);

const pt = (k: bigint): string => encodePoint(G.multiply(k));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Deep-set `value` at a path of keys and indices on a clone of `root`. */
function withAt(root: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const out = clone(root) as Record<string | number, unknown>;
  let cur = out;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  cur[path[path.length - 1] as string | number] = value;
  return out;
}

/** A sparse copy of `xs` with a missing index (not `undefined`) at `i`; `.every` would skip it. */
function holeAt<T>(xs: readonly T[], i: number): T[] {
  const out = new Array<T>(xs.length);
  for (let k = 0; k < xs.length; k++) if (k !== i) out[k] = xs[k] as T;
  return out;
}

function be32(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function pointBytes(prefix: number, x: Uint8Array): string {
  const bytes = new Uint8Array(33);
  bytes[0] = prefix;
  bytes.set(x, 1);
  return b64u.encode(bytes);
}

/** x with no square root of x^3 + 7 (searched, not assumed). */
function offCurveX(): bigint {
  for (let x = 1n; x < 200n; x++) {
    try {
      secp256k1.Point.fromBytes(Uint8Array.from([2, ...be32(x)])).assertValidity();
    } catch {
      return x;
    }
  }
  throw new Error('no off-curve x found');
}

const NON_STRINGS: [string, unknown][] = [
  ['a number', 5],
  ['null', null],
  ['an object', {}],
  ['an array', []],
  ['a boolean', true],
  ['undefined', undefined],
];

const good = pt(7n);

/** Hostile values for a point slot. */
const BAD_POINTS: [string, unknown][] = [
  ['the identity', b64u.encode(new Uint8Array(33))],
  ['an off-curve x', pointBytes(2, be32(offCurveX()))],
  ['prefix 0x05', pointBytes(5, G.toBytes(true).slice(1))],
  ['x >= p', pointBytes(2, new Uint8Array(32).fill(0xff))],
  ['x = p', pointBytes(2, be32(P))],
  ['padding', `${good.slice(0, 43)}=`],
  ['a + character', `${good.slice(0, 43)}+`],
  ['a / character', `${good.slice(0, 43)}/`],
  ['too short', good.slice(0, 43)],
  ['too long', `${good}A`],
  ['empty', ''],
  ...NON_STRINGS,
];

/** Hostile values for a scalar slot. */
const goodS = encodeScalar(7n);
const BAD_SCALARS: [string, unknown][] = [
  ['q', b64u.encode(be32(q))],
  ['q + 1', b64u.encode(be32(q + 1n))],
  ['2^256 - 1', b64u.encode(new Uint8Array(32).fill(0xff))],
  ['non-zero spare bits', `${encodeScalar(0n).slice(0, 42)}B`],
  ['padding', `${goodS.slice(0, 42)}=`],
  ['a + character', `${goodS.slice(0, 42)}+`],
  ['a / character', `${goodS.slice(0, 42)}/`],
  ['too short', goodS.slice(0, 42)],
  ['too long', `${goodS}A`],
  ['a point-length string', good],
  ['empty', ''],
  ...NON_STRINGS,
];

/* ---------------------------------------------------------------------------------------------- tests */

describe('DeckWireError', () => {
  it('is an Error subclass with a name', () => {
    const e = new DeckWireError('x');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('DeckWireError');
    expect(e.message).toBe('x');
  });
});

describe('deck codec', () => {
  it('round-trips, with and without a length', () => {
    for (const back of [decodeDeck(wireDeck), decodeDeck(wireDeck, N)]) {
      expect(back).toHaveLength(N);
      back.forEach((e, i) => {
        expect(e.a.equals((fx.out[i] as { a: Point }).a)).toBe(true);
        expect(e.b.equals((fx.out[i] as { b: Point }).b)).toBe(true);
      });
    }
  });

  it('survives a JSON round trip and the canonical form', () => {
    const text = canonicalJson(wireDeck);
    expect(canonicalJson(encodeDeck(decodeDeck(JSON.parse(text))))).toBe(text);
  });

  it('encodes points as 44-character base64url strings', () => {
    for (const [a, b] of wireDeck) {
      expect(a).toHaveLength(44);
      expect(b).toHaveLength(44);
    }
  });

  it('encoders throw on the identity', () => {
    expect(() => encodeDeck([{ a: ZERO, b: G }])).toThrow();
    expect(() => encodeDeck([{ a: G, b: ZERO }])).toThrow();
  });

  it('rejects an empty deck, whatever n is', () => {
    expect(() => decodeDeck([])).toThrow(DeckWireError);
    expect(() => decodeDeck([], 0)).toThrow();
  });

  it('rejects a wrong length when n is given', () => {
    expect(() => decodeDeck(wireDeck, N + 1)).toThrow(DeckWireError);
    expect(() => decodeDeck(wireDeck, N - 1)).toThrow(DeckWireError);
  });

  it('rejects a bad n as a caller error', () => {
    expect(() => decodeDeck(wireDeck, 0)).toThrow(RangeError);
    expect(() => decodeDeck(wireDeck, 1.5)).toThrow(RangeError);
  });

  it('rejects a non-array, a non-pair, a triple and a non-array row', () => {
    for (const bad of [null, 5, 'x', {}, { length: 1, 0: [good, good] }]) {
      expect(() => decodeDeck(bad)).toThrow(DeckWireError);
    }
    expect(() => decodeDeck([[good]])).toThrow(DeckWireError);
    expect(() => decodeDeck([[good, good, good]])).toThrow(DeckWireError);
    expect(() => decodeDeck([good])).toThrow(DeckWireError);
    expect(() => decodeDeck([{ 0: good, 1: good, length: 2 }])).toThrow(DeckWireError);
  });

  it('rejects holes in the deck and in a pair', () => {
    expect(() => decodeDeck(holeAt(wireDeck, 2), N)).toThrow(DeckWireError);
    expect(() => decodeDeck([holeAt([good, good], 1)])).toThrow(DeckWireError);
    expect(() => decodeDeck([holeAt([good, good], 0)])).toThrow(DeckWireError);
  });

  for (const [name, bad] of BAD_POINTS) {
    it(`rejects ${name} as a or b`, () => {
      expect(() => decodeDeck(withAt(wireDeck, [0, 0], bad))).toThrow(DeckWireError);
      expect(() => decodeDeck(withAt(wireDeck, [N - 1, 1], bad), N)).toThrow(DeckWireError);
    });
  }

  it('names the path of the defect', () => {
    expect(() => decodeDeck(withAt(wireDeck, [3, 1], 'AA'))).toThrow(/^deck\[3\]\[1\]: /);
    expect(() => decodeDeck(withAt(wireDeck, [2], [good]))).toThrow(/^deck\[2\]: /);
  });
});

describe('shuffle proof codec', () => {
  it('has the PROTOCOL shape', () => {
    const w = wireProof as Record<string, Record<string, unknown> | unknown[]>;
    expect(Object.keys(w).sort()).toEqual(['c', 'cHat', 's', 't']);
    expect(Object.keys(w.s as object).sort()).toEqual(['s1', 's2', 's3', 's4', 'sHat', 'sPrime']);
    expect(Object.keys(w.t as object).sort()).toEqual(['t1', 't2', 't3', 't4', 'tHat']);
    expect((w.c as unknown[]).length).toBe(N);
    expect(((w.t as Record<string, unknown[]>).t4 as unknown[]).length).toBe(2);
    expect(((w.s as Record<string, unknown[]>).sPrime as unknown[]).length).toBe(N);
  });

  it('round-trips', () => {
    const back = decodeShuffleProof(wireProof, N);
    const p = fx.proof;
    const same = (xs: readonly Point[], ys: readonly Point[]): boolean =>
      xs.length === ys.length && xs.every((x, i) => x.equals(ys[i] as Point));
    expect(same(back.c, p.c)).toBe(true);
    expect(same(back.cHat, p.cHat)).toBe(true);
    expect(same(back.t.tHat, p.t.tHat)).toBe(true);
    expect(same(back.t.t4, p.t.t4)).toBe(true);
    for (const k of ['t1', 't2', 't3'] as const) expect(back.t[k].equals(p.t[k])).toBe(true);
    expect(back.s).toEqual(p.s);
  });

  it('a decoded honest proof still verifies, through a JSON round trip', () => {
    const back = decodeShuffleProof(JSON.parse(canonicalJson(wireProof)), N);
    const out = decodeDeck(JSON.parse(canonicalJson(wireDeck)), N);
    expect(verifyShuffle(fx.input, out, fx.X, back, fx.ctx)).toBe(true);
  });

  it('round-trips and verifies for N = 1', () => {
    const one = setup(1, 'wire-n1');
    const back = decodeShuffleProof(encodeShuffleProof(one.proof), 1);
    expect(verifyShuffle(one.input, decodeDeck(encodeDeck(one.out), 1), one.X, back, one.ctx)).toBe(true);
  });

  it('encoders throw on the identity', () => {
    expect(() => encodeShuffleProof({ ...fx.proof, c: [ZERO, ...fx.proof.c.slice(1)] })).toThrow();
    expect(() => encodeShuffleProof({ ...fx.proof, t: { ...fx.proof.t, t1: ZERO } })).toThrow();
  });

  it('rejects a bad n as a caller error', () => {
    expect(() => decodeShuffleProof(wireProof, 0)).toThrow(RangeError);
    expect(() => decodeShuffleProof(wireProof, -1)).toThrow(RangeError);
  });

  it('rejects a wrong deck size', () => {
    expect(() => decodeShuffleProof(wireProof, N + 1)).toThrow(DeckWireError);
    expect(() => decodeShuffleProof(wireProof, N - 1)).toThrow(DeckWireError);
  });

  it('rejects non-objects and non-plain objects at every object level', () => {
    class Fake {}
    const levels: (readonly string[])[] = [[], ['s'], ['t']];
    for (const path of levels) {
      const replace = (v: unknown): unknown => (path.length === 0 ? v : withAt(wireProof, path, v));
      for (const bad of [null, 5, 'x', [], new Map(), new Fake(), () => 0]) {
        expect(() => decodeShuffleProof(replace(bad), N)).toThrow(DeckWireError);
      }
    }
  });

  it('accepts a null-prototype object but not one with another prototype', () => {
    const np = Object.assign(Object.create(null) as object, clone(wireProof));
    expect(() => decodeShuffleProof(np, N)).not.toThrow();
    const odd = Object.assign(Object.create({ inherited: 1 }) as object, clone(wireProof));
    expect(() => decodeShuffleProof(odd, N)).toThrow(DeckWireError);
  });

  it('rejects extra keys at every level', () => {
    for (const path of [['x'], ['s', 'x'], ['t', 'x']]) {
      expect(() => decodeShuffleProof(withAt(wireProof, path, good), N)).toThrow(DeckWireError);
    }
    const sym = clone(wireProof) as Record<symbol, unknown>;
    sym[Symbol('x')] = 1;
    expect(() => decodeShuffleProof(sym, N)).toThrow(DeckWireError);
  });

  it('rejects an own __proto__ key from JSON.parse', () => {
    const text = JSON.stringify(wireProof).replace('{', `{"__proto__":${JSON.stringify(good)},`);
    expect(() => decodeShuffleProof(JSON.parse(text), N)).toThrow(DeckWireError);
  });

  it('rejects every missing key', () => {
    const paths: (readonly string[])[] = [
      ['c'],
      ['cHat'],
      ['s'],
      ['t'],
      ...['s1', 's2', 's3', 's4', 'sHat', 'sPrime'].map((k) => ['s', k]),
      ...['t1', 't2', 't3', 't4', 'tHat'].map((k) => ['t', k]),
    ];
    for (const path of paths) {
      const w = clone(wireProof) as Record<string, Record<string, unknown>>;
      if (path.length === 1) delete w[path[0] as string];
      else delete (w[path[0] as string] as Record<string, unknown>)[path[1] as string];
      expect(() => decodeShuffleProof(w, N), path.join('.')).toThrow(DeckWireError);
    }
  });

  it('rejects wrong array lengths and non-arrays', () => {
    const arrays: (readonly string[])[] = [
      ['c'],
      ['cHat'],
      ['s', 'sHat'],
      ['s', 'sPrime'],
      ['t', 't4'],
      ['t', 'tHat'],
    ];
    for (const path of arrays) {
      const cur = path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], wireProof) as unknown[];
      for (const bad of [cur.slice(1), [...cur, cur[0]], [], null, 'x', {}, 5]) {
        expect(() => decodeShuffleProof(withAt(wireProof, path, bad), N), path.join('.')).toThrow(
          DeckWireError,
        );
      }
    }
  });

  it('rejects holes in every array, which `.every` would skip', () => {
    const arrays: (readonly string[])[] = [
      ['c'],
      ['cHat'],
      ['s', 'sHat'],
      ['s', 'sPrime'],
      ['t', 't4'],
      ['t', 'tHat'],
    ];
    for (const path of arrays) {
      const cur = path.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], wireProof) as unknown[];
      for (const i of [0, cur.length - 1]) {
        const bad = withAt(wireProof, path, []) as Record<string, unknown>;
        // Set the holed array directly: JSON cloning would turn the hole into null.
        let o = bad;
        for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
        o[path[path.length - 1] as string] = holeAt(cur, i);
        expect(() => decodeShuffleProof(bad, N), `${path.join('.')}[${i}]`).toThrow(DeckWireError);
      }
    }
  });

  const POINT_SLOTS: (readonly (string | number)[])[] = [
    ['c', 0],
    ['c', N - 1],
    ['cHat', 0],
    ['cHat', N - 1],
    ['t', 't1'],
    ['t', 't2'],
    ['t', 't3'],
    ['t', 't4', 0],
    ['t', 't4', 1],
    ['t', 'tHat', 0],
    ['t', 'tHat', N - 1],
  ];
  const SCALAR_SLOTS: (readonly (string | number)[])[] = [
    ['s', 's1'],
    ['s', 's2'],
    ['s', 's3'],
    ['s', 's4'],
    ['s', 'sHat', 0],
    ['s', 'sHat', N - 1],
    ['s', 'sPrime', 0],
    ['s', 'sPrime', N - 1],
  ];

  it('every hostile point is rejected in every point slot', () => {
    for (const slot of POINT_SLOTS) {
      for (const [name, bad] of BAD_POINTS) {
        expect(
          () => decodeShuffleProof(withAt(wireProof, slot, bad), N),
          `${slot.join('.')}: ${name}`,
        ).toThrow(DeckWireError);
      }
    }
  });

  it('every hostile scalar is rejected in every scalar slot', () => {
    for (const slot of SCALAR_SLOTS) {
      for (const [name, bad] of BAD_SCALARS) {
        expect(
          () => decodeShuffleProof(withAt(wireProof, slot, bad), N),
          `${slot.join('.')}: ${name}`,
        ).toThrow(DeckWireError);
      }
    }
  });

  it('a scalar slot rejects a point and a point slot rejects a scalar', () => {
    expect(() => decodeShuffleProof(withAt(wireProof, ['s', 's1'], good), N)).toThrow(DeckWireError);
    expect(() => decodeShuffleProof(withAt(wireProof, ['t', 't1'], goodS), N)).toThrow(DeckWireError);
  });

  it('names the path of the defect', () => {
    expect(() => decodeShuffleProof(withAt(wireProof, ['t', 'tHat', 3], 'AA'), N)).toThrow(
      /^proof\.t\.tHat\[3\]: /,
    );
    expect(() => decodeShuffleProof(withAt(wireProof, ['s', 'sPrime', 1], 5), N)).toThrow(
      /^proof\.s\.sPrime\[1\]: /,
    );
    expect(() => decodeShuffleProof(withAt(wireProof, ['x'], 1), N)).toThrow(/^proof: /);
    expect(() => decodeShuffleProof(withAt(wireProof, ['c'], []), N)).toThrow(/^proof\.c: /);
  });
});

describe('share codec', () => {
  const ct = fx.out[0] as { a: Point; b: Point };
  const x = fx.secrets[0] as bigint;
  const X = G.multiply(x);
  const ctx = { rootId: 'root', deckId: DECK, pos: 17 };
  const share = makeShare(x, ct, ctx, seededRandom('wire-share'));
  const wire = encodeShare({ pos: 17, share });

  it('has the PROTOCOL shape', () => {
    expect(Object.keys(wire).sort()).toEqual(['d', 'pos', 'proof']);
    expect(Object.keys(wire.proof).sort()).toEqual(['c', 's']);
    expect(wire.pos).toBe(17);
    expect(wire.d).toHaveLength(44);
    expect(wire.proof.c).toHaveLength(43);
  });

  it('round-trips and still verifies', () => {
    const back = decodeShare(JSON.parse(canonicalJson(wire)));
    expect(back.pos).toBe(17);
    expect(back.share.D.equals(share.D)).toBe(true);
    expect(back.share.c).toBe(share.c);
    expect(back.share.s).toBe(share.s);
    expect(verifyShare(X, ct, back.share, { ...ctx, pos: back.pos })).toBe(true);
  });

  it('accepts pos 0 and the largest safe integer', () => {
    expect(decodeShare({ ...wire, pos: 0 }).pos).toBe(0);
    expect(decodeShare({ ...wire, pos: Number.MAX_SAFE_INTEGER }).pos).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('encoder rejects a bad pos and an identity D', () => {
    for (const pos of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => encodeShare({ pos, share })).toThrow();
    }
    expect(() => encodeShare({ pos: 0, share: { ...share, D: ZERO } })).toThrow();
  });

  it('rejects a bad pos', () => {
    for (const pos of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2 ** 53,
      '1',
      null,
      {},
      [],
      true,
      undefined,
    ]) {
      expect(() => decodeShare({ ...wire, pos }), String(pos)).toThrow(/^share\.pos: /);
    }
  });

  it('rejects non-objects, extra keys and missing keys', () => {
    for (const bad of [null, 5, 'x', [], [wire]]) expect(() => decodeShare(bad)).toThrow(DeckWireError);
    expect(() => decodeShare({ ...wire, extra: 1 })).toThrow(DeckWireError);
    expect(() => decodeShare({ ...wire, proof: { ...wire.proof, extra: 1 } })).toThrow(DeckWireError);
    for (const k of ['d', 'pos', 'proof'] as const) {
      const { [k]: _omit, ...rest } = wire;
      expect(() => decodeShare(rest), k).toThrow(DeckWireError);
    }
    for (const k of ['c', 's'] as const) {
      const { [k]: _omit, ...rest } = wire.proof;
      expect(() => decodeShare({ ...wire, proof: rest }), k).toThrow(DeckWireError);
    }
    for (const bad of [null, 5, 'x', [], undefined]) {
      expect(() => decodeShare({ ...wire, proof: bad })).toThrow(DeckWireError);
    }
  });

  for (const [name, bad] of BAD_POINTS) {
    it(`rejects ${name} as d`, () => {
      expect(() => decodeShare({ ...wire, d: bad })).toThrow(/^share\.d: /);
    });
  }

  for (const [name, bad] of BAD_SCALARS) {
    it(`rejects ${name} as proof.c and proof.s`, () => {
      expect(() => decodeShare({ ...wire, proof: { ...wire.proof, c: bad } })).toThrow(/^share\.proof\.c: /);
      expect(() => decodeShare({ ...wire, proof: { ...wire.proof, s: bad } })).toThrow(/^share\.proof\.s: /);
    });
  }
});

describe('pok codec', () => {
  const rnd = seededRandom('wire-pok');
  const x = randomScalar(rnd);
  const X = G.multiply(x);
  const pctx = ['tableaddr', 'npub1abc', 'sessionpub'];
  const proof = provePok(x, pctx, rnd);
  const wire = encodePok(proof);

  it('has the PROTOCOL shape and round-trips', () => {
    expect(Object.keys(wire).sort()).toEqual(['c', 's']);
    expect(wire.c).toHaveLength(43);
    expect(decodePok(JSON.parse(canonicalJson(wire)))).toEqual({ c: proof.c, s: proof.s });
  });

  it('a decoded proof still verifies', () => {
    expect(verifyPok(X, decodePok(JSON.parse(canonicalJson(wire))), pctx)).toBe(true);
  });

  it('rejects non-objects, extra keys and missing keys', () => {
    for (const bad of [null, 5, 'x', [], [wire.c, wire.s]]) {
      expect(() => decodePok(bad)).toThrow(DeckWireError);
    }
    expect(() => decodePok({ ...wire, extra: 1 })).toThrow(DeckWireError);
    expect(() => decodePok({ c: wire.c })).toThrow(DeckWireError);
    expect(() => decodePok({ s: wire.s })).toThrow(DeckWireError);
    expect(() => decodePok({})).toThrow(DeckWireError);
  });

  for (const [name, bad] of BAD_SCALARS) {
    it(`rejects ${name} as c and s`, () => {
      expect(() => decodePok({ ...wire, c: bad })).toThrow(/^pok\.c: /);
      expect(() => decodePok({ ...wire, s: bad })).toThrow(/^pok\.s: /);
    });
  }

  it('a point-length string is not a scalar', () => {
    expect(() => decodePok({ ...wire, c: pt(3n) })).toThrow(DeckWireError);
  });
});

describe('size', () => {
  it('a 108-card shuffle step is under 40000 bytes of canonical JSON', { timeout: 60_000 }, () => {
    const big = setup(108, 'wire-108');
    const bytes =
      canonicalJson(encodeShuffleProof(big.proof)).length + canonicalJson(encodeDeck(big.out)).length;
    console.log(`N=108 shuffle step content: ${bytes} bytes`);
    expect(bytes).toBeLessThan(40000);
    // Parsing back what honest peers send still verifies at full size.
    const back = decodeShuffleProof(JSON.parse(canonicalJson(encodeShuffleProof(big.proof))), 108);
    const out = decodeDeck(JSON.parse(canonicalJson(encodeDeck(big.out))), 108);
    expect(verifyShuffle(big.input, out, big.X, back, big.ctx)).toBe(true);
  });
});
