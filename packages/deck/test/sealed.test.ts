import { describe, expect, it } from 'vitest';
import { cardOf, cardTable } from '../src/cards.ts';
import { combine, makeShare, ownShare, type ShareCtx } from '../src/dleq.ts';
import { type Ciphertext, initialDeck, jointKey, reEncrypt } from '../src/elgamal.ts';
import { b64u, decodePoint, encodePoint, type Point } from '../src/encoding.ts';
import { G, q } from '../src/group.ts';
import { randomScalar } from '../src/random.ts';
import {
  openAndVerify,
  openSealedShare,
  proveOpening,
  type SealedOpening,
  type SealedShare,
  sealShare,
  verifyOpening,
  verifySealedShare,
} from '../src/sealed.ts';
import {
  DeckWireError,
  decodeSealedOpening,
  decodeSealedShare,
  encodeSealedOpening,
  encodeSealedShare,
} from '../src/wire.ts';
import { seededRandom } from './util.ts';

const rnd = seededRandom('sealed-1');
const secrets = [randomScalar(rnd), randomScalar(rnd), randomScalar(rnd)];
const keys = secrets.map((x) => G.multiply(x));
const X = jointKey(keys);
const table = cardTable('cards', 50);

/** Card `m` of deck `cards`, encrypted under the joint key by three layers, as after a shuffle. */
function encrypted(m: number): Ciphertext {
  let c = initialDeck('cards', m + 1)[m] as Ciphertext;
  for (let i = 0; i < 3; i++) c = reEncrypt(c, X, randomScalar(rnd));
  return c;
}

const ctx: ShareCtx = { rootId: 'root-1', deckId: 'cards', pos: 7 };
const ct = encrypted(17);
const other = encrypted(23); // another position's ciphertext
const k = 1; // sender
const T = 2; // recipient
const xk = secrets[k] as bigint;
const xT = secrets[T] as bigint;
const Xk = keys[k] as Point;
const XT = keys[T] as Point;
const sealed = sealShare(xk, ct, XT, ctx, rnd);

describe('sealed shares: round trip', () => {
  it('verifies, and only the recipient opens it to the sender’s decryption share', () => {
    expect(verifySealedShare(Xk, ct, XT, sealed, ctx)).toBe(true);
    const D = openSealedShare(xT, sealed);
    expect(D.equals(ct.a.multiply(xk))).toBe(true);
    // Any other secret opens it to something else.
    expect(openSealedShare(secrets[0] as bigint, sealed).equals(D)).toBe(false);
    expect(openSealedShare(xk, sealed).equals(D)).toBe(false);
  });

  it('decrypts a card visible to every seat but its owner (a Hanabi-style viewer set)', () => {
    // Seat 0 owns the card and publishes an ordinary share; seats 1 and 2 seal theirs to each other.
    const owner = makeShare(secrets[0] as bigint, ct, ctx, rnd);
    const s12 = sealShare(secrets[1] as bigint, ct, keys[2] as Point, ctx, rnd);
    const s21 = sealShare(secrets[2] as bigint, ct, keys[1] as Point, ctx, rnd);
    expect(verifySealedShare(keys[1] as Point, ct, keys[2] as Point, s12, ctx)).toBe(true);
    expect(verifySealedShare(keys[2] as Point, ct, keys[1] as Point, s21, ctx)).toBe(true);
    const at1 = combine(ct, [
      owner.D,
      openSealedShare(secrets[1] as bigint, s21),
      ownShare(secrets[1] as bigint, ct),
    ]);
    const at2 = combine(ct, [
      owner.D,
      openSealedShare(secrets[2] as bigint, s12),
      ownShare(secrets[2] as bigint, ct),
    ]);
    expect(cardOf(table, at1)).toBe(17);
    expect(cardOf(table, at2)).toBe(17);
    // The owner holds its own layer and the public share only: the two sealed pairs open to garbage for it.
    const guess = combine(ct, [
      ownShare(secrets[0] as bigint, ct),
      openSealedShare(secrets[0] as bigint, s12),
      openSealedShare(secrets[0] as bigint, s21),
    ]);
    expect(cardOf(table, guess)).toBe(null);
  });

  it('is deterministic under a seeded source and fresh for each call otherwise', () => {
    const a = sealShare(xk, ct, XT, ctx, seededRandom('same'));
    const b = sealShare(xk, ct, XT, ctx, seededRandom('same'));
    expect(a.A.equals(b.A) && a.B.equals(b.B) && a.c === b.c && a.s1 === b.s1 && a.s2 === b.s2).toBe(true);
    const c = sealShare(xk, ct, XT, ctx, rnd);
    expect(c.A.equals(sealed.A)).toBe(false);
    expect(openSealedShare(xT, c).equals(openSealedShare(xT, sealed))).toBe(true);
  });
});

describe('sealed shares: tampering and misbinding are rejected', () => {
  const ok = (s: SealedShare, over: Partial<{ X: Point; ct: Ciphertext; XT: Point; ctx: ShareCtx }> = {}) =>
    verifySealedShare(over.X ?? Xk, over.ct ?? ct, over.XT ?? XT, s, over.ctx ?? ctx);

  it('every field mutated fails', () => {
    const cases: Record<string, SealedShare> = {
      'A + G': { ...sealed, A: sealed.A.add(G) },
      'B + G': { ...sealed, B: sealed.B.add(G) },
      'A and B rerandomized': { ...sealed, A: sealed.A.add(G), B: sealed.B.add(XT) },
      'A, B swapped': { ...sealed, A: sealed.B, B: sealed.A },
      'c + 1': { ...sealed, c: (sealed.c + 1n) % q },
      's1 + 1': { ...sealed, s1: (sealed.s1 + 1n) % q },
      's2 + 1': { ...sealed, s2: (sealed.s2 + 1n) % q },
      's1, s2 swapped': { ...sealed, s1: sealed.s2, s2: sealed.s1 },
    };
    for (const [name, s] of Object.entries(cases)) expect(ok(s), name).toBe(false);
  });

  it('the wrong sender, recipient, ciphertext, position, deck or root fails', () => {
    expect(ok(sealed, { X: keys[0] as Point }), 'sender').toBe(false);
    expect(ok(sealed, { X: Xk.add(G) }), 'sender key + G').toBe(false);
    expect(ok(sealed, { XT: keys[0] as Point }), 'recipient').toBe(false);
    expect(ok(sealed, { XT: XT.add(G) }), 'recipient key + G').toBe(false);
    expect(ok(sealed, { ct: other }), 'another ciphertext').toBe(false);
    expect(ok(sealed, { ct: { a: ct.a, b: ct.b.add(G) } }), 'ciphertext b').toBe(false);
    expect(ok(sealed, { ctx: { ...ctx, pos: 8 } }), 'pos').toBe(false);
    expect(ok(sealed, { ctx: { ...ctx, deckId: 'tiles' } }), 'deck').toBe(false);
    expect(ok(sealed, { ctx: { ...ctx, rootId: 'root-2' } }), 'root').toBe(false);
  });

  it('a proof replayed onto another position fails, even with that position’s own ciphertext', () => {
    const at8: ShareCtx = { ...ctx, pos: 8 };
    expect(verifySealedShare(Xk, other, XT, sealed, at8)).toBe(false);
    // A genuine sealed share of position 8 verifies there and nowhere else.
    const s8 = sealShare(xk, other, XT, at8, rnd);
    expect(verifySealedShare(Xk, other, XT, s8, at8)).toBe(true);
    expect(verifySealedShare(Xk, ct, XT, s8, ctx)).toBe(false);
    expect(verifySealedShare(Xk, other, XT, s8, ctx)).toBe(false);
  });

  it('cannot be retargeted: the same pair, or the opened share sealed anew without the sender’s secret, fails', () => {
    // Seat 0 holds nothing of seat 1's secret: re-encrypting the opened D to seat 0 has no valid proof.
    const D = openSealedShare(xT, sealed);
    const r = randomScalar(rnd);
    const forged: SealedShare = { ...sealed, A: G.multiply(r), B: D.add((keys[0] as Point).multiply(r)) };
    expect(verifySealedShare(Xk, ct, keys[0] as Point, forged, ctx)).toBe(false);
    expect(verifySealedShare(Xk, ct, keys[0] as Point, sealed, ctx)).toBe(false);
  });

  it('a share sealed with another secret does not verify for the claimed sender', () => {
    const s = sealShare(secrets[0] as bigint, ct, XT, ctx, rnd);
    expect(verifySealedShare(Xk, ct, XT, s, ctx)).toBe(false);
    expect(verifySealedShare(keys[0] as Point, ct, XT, s, ctx)).toBe(true);
  });

  it('malformed input returns false and never throws', () => {
    const Z = G.subtract(G);
    const bad: [string, () => boolean][] = [
      ['identity A', () => ok({ ...sealed, A: Z })],
      ['identity B', () => ok({ ...sealed, B: Z })],
      ['identity X', () => ok(sealed, { X: Z })],
      ['identity XT', () => ok(sealed, { XT: Z })],
      ['identity a', () => ok(sealed, { ct: { a: Z, b: ct.b } })],
      ['X equals XT', () => ok(sealed, { XT: Xk })],
      ['c = q', () => ok({ ...sealed, c: q })],
      ['s1 = -1', () => ok({ ...sealed, s1: -1n })],
      ['s2 not a bigint', () => ok({ ...sealed, s2: 1 as unknown as bigint })],
      ['A not a point', () => ok({ ...sealed, A: {} as Point })],
      ['bad pos', () => ok(sealed, { ctx: { ...ctx, pos: -1 } })],
      ['fractional pos', () => ok(sealed, { ctx: { ...ctx, pos: 1.5 } })],
      ['lone surrogate root', () => ok(sealed, { ctx: { ...ctx, rootId: '\uD800' } })],
      ['null ciphertext', () => verifySealedShare(Xk, null as unknown as Ciphertext, XT, sealed, ctx)],
    ];
    for (const [name, run] of bad) expect(run(), name).toBe(false);
  });

  it('sealShare refuses caller errors', () => {
    const Z = G.subtract(G);
    expect(() => sealShare(0n, ct, XT, ctx, rnd)).toThrow(RangeError);
    expect(() => sealShare(q, ct, XT, ctx, rnd)).toThrow(RangeError);
    expect(() => sealShare(xk, ct, Z, ctx, rnd)).toThrow(RangeError);
    expect(() => sealShare(xk, ct, Xk, ctx, rnd)).toThrow(/own key/);
    expect(() => sealShare(xk, { a: Z, b: ct.b }, XT, ctx, rnd)).toThrow(RangeError);
    expect(() => sealShare(xk, ct, XT, { ...ctx, pos: -1 }, rnd)).toThrow(RangeError);
    expect(() => openSealedShare(0n, sealed)).toThrow(RangeError);
    expect(() => openSealedShare(xT, { A: Z, B: sealed.B })).toThrow(RangeError);
  });
});

describe('transferable opening', () => {
  const opening = proveOpening(xT, Xk, ct, sealed, ctx, rnd);

  it('lets anyone read the opened share without the recipient’s secret', () => {
    const D = verifyOpening(Xk, XT, ct, sealed, opening, ctx);
    expect(D?.equals(ct.a.multiply(xk))).toBe(true);
  });

  it('rejects every tampered field and every misbinding', () => {
    const cases: Record<string, () => Point | null> = {
      'E + G': () => verifyOpening(Xk, XT, ct, sealed, { ...opening, E: opening.E.add(G) }, ctx),
      'c + 1': () => verifyOpening(Xk, XT, ct, sealed, { ...opening, c: (opening.c + 1n) % q }, ctx),
      's + 1': () => verifyOpening(Xk, XT, ct, sealed, { ...opening, s: (opening.s + 1n) % q }, ctx),
      'wrong recipient': () => verifyOpening(Xk, keys[0] as Point, ct, sealed, opening, ctx),
      'wrong sender': () => verifyOpening(keys[0] as Point, XT, ct, sealed, opening, ctx),
      'B + G': () => verifyOpening(Xk, XT, ct, { ...sealed, B: sealed.B.add(G) }, opening, ctx),
      'A + G': () => verifyOpening(Xk, XT, ct, { ...sealed, A: sealed.A.add(G) }, opening, ctx),
      pos: () => verifyOpening(Xk, XT, ct, sealed, opening, { ...ctx, pos: 8 }),
      deck: () => verifyOpening(Xk, XT, ct, sealed, opening, { ...ctx, deckId: 'tiles' }),
      root: () => verifyOpening(Xk, XT, ct, sealed, opening, { ...ctx, rootId: 'root-2' }),
      'c = q': () => verifyOpening(Xk, XT, ct, sealed, { ...opening, c: q }, ctx),
      'E identity': () => verifyOpening(Xk, XT, ct, sealed, { ...opening, E: G.subtract(G) }, ctx),
    };
    for (const [name, run] of Object.entries(cases)) expect(run(), name).toBe(null);
  });

  it('an ordinary decryption share is not an opening, nor the reverse', () => {
    // The DLEQ of an ordinary share proves log_G X_T = log_A E under the "dleq" label; it fails as an opening.
    const share = makeShare(xT, { a: sealed.A, b: sealed.B }, ctx, rnd);
    const asOpening: SealedOpening = { E: share.D, c: share.c, s: share.s };
    expect(verifyOpening(Xk, XT, ct, sealed, asOpening, ctx)).toBe(null);
  });
});

describe('sealed share codecs', () => {
  const wire = encodeSealedShare({ pos: 7, to: 2, sealed });

  it('round-trips', () => {
    const back = decodeSealedShare(JSON.parse(JSON.stringify(wire)));
    expect(back.pos).toBe(7);
    expect(back.to).toBe(2);
    expect(back.sealed.A.equals(sealed.A) && back.sealed.B.equals(sealed.B)).toBe(true);
    expect([back.sealed.c, back.sealed.s1, back.sealed.s2]).toEqual([sealed.c, sealed.s1, sealed.s2]);
    expect(verifySealedShare(Xk, ct, XT, back.sealed, ctx)).toBe(true);
    const ow = encodeSealedOpening({ pos: 7, from: 1, opening: proveOpening(xT, Xk, ct, sealed, ctx, rnd) });
    const ob = decodeSealedOpening(JSON.parse(JSON.stringify(ow)));
    expect(ob.pos).toBe(7);
    expect(ob.from).toBe(1);
    expect(verifyOpening(Xk, XT, ct, sealed, ob.opening, ctx)?.equals(ct.a.multiply(xk))).toBe(true);
  });

  it('accepts exactly one shape', () => {
    const big = b64u.encode(new Uint8Array(32).fill(255)); // 2^256 − 1 ≥ q
    const bad: [string, unknown][] = [
      ['extra key', { ...wire, x: 1 }],
      ['missing to', { a: wire.a, b: wire.b, pos: 7, proof: wire.proof }],
      ['to negative', { ...wire, to: -1 }],
      ['to string', { ...wire, to: '2' }],
      ['pos fractional', { ...wire, pos: 1.5 }],
      ['pos -0', { ...wire, pos: -0 }],
      ['a not a point', { ...wire, a: 'x'.repeat(44) }],
      ['b identity-ish', { ...wire, b: 'A'.repeat(44) }],
      ['proof extra key', { ...wire, proof: { ...wire.proof, s3: wire.proof.s1 } }],
      ['proof missing s2', { ...wire, proof: { c: wire.proof.c, s1: wire.proof.s1 } }],
      ['scalar ≥ q', { ...wire, proof: { ...wire.proof, c: big } }],
      ['array', [wire]],
      ['null', null],
    ];
    for (const [name, v] of bad) expect(() => decodeSealedShare(v), name).toThrow(DeckWireError);
    expect(() => decodeSealedOpening({ e: wire.a, from: 1, pos: 7, proof: { c: wire.proof.c } })).toThrow(
      DeckWireError,
    );
    expect(() => encodeSealedShare({ pos: -1, to: 2, sealed })).toThrow(RangeError);
    expect(() => encodeSealedShare({ pos: 7, to: 0.5, sealed })).toThrow(RangeError);
  });

  it('points on the wire are the package’s canonical encodings', () => {
    expect(decodePoint(wire.a).equals(sealed.A)).toBe(true);
    expect(wire.b).toBe(encodePoint(sealed.B));
  });
});

describe('round 2: openAndVerify, the guarded opening and hedged nonces', () => {
  it('openAndVerify opens a verified share and returns null for anything else', () => {
    expect(openAndVerify(xT, Xk, ct, sealed, ctx)?.equals(ct.a.multiply(xk))).toBe(true);
    const bad: Record<string, Point | null> = {
      'wrong recipient secret': openAndVerify(secrets[0] as bigint, Xk, ct, sealed, ctx),
      'the sender opening its own': openAndVerify(xk, Xk, ct, sealed, ctx),
      'wrong sender key': openAndVerify(xT, keys[0] as Point, ct, sealed, ctx),
      'another ciphertext': openAndVerify(xT, Xk, other, sealed, ctx),
      'another position': openAndVerify(xT, Xk, ct, sealed, { ...ctx, pos: 8 }),
      'B + G': openAndVerify(xT, Xk, ct, { ...sealed, B: sealed.B.add(G) }, ctx),
      's1 + 1': openAndVerify(xT, Xk, ct, { ...sealed, s1: (sealed.s1 + 1n) % q }, ctx),
      'secret 0': openAndVerify(0n, Xk, ct, sealed, ctx),
      'secret q': openAndVerify(q, Xk, ct, sealed, ctx),
    };
    for (const [name, D] of Object.entries(bad)) expect(D, name).toBe(null);
  });

  it('proveOpening refuses an unverified share, so it is not a decryption oracle', () => {
    // A forger hands T a "sealed share" whose A is a deck position's a: opening it would publish x_T·a, T's own
    // decryption share of that position.
    const forged: SealedShare = { ...sealed, A: other.a };
    expect(() => proveOpening(xT, Xk, ct, forged, ctx, rnd)).toThrow(/does not verify/);
    expect(() => proveOpening(xT, Xk, other, sealed, ctx, rnd)).toThrow(/does not verify/);
    expect(() => proveOpening(xT, keys[0] as Point, ct, sealed, ctx, rnd)).toThrow(/does not verify/);
    expect(() => proveOpening(secrets[0] as bigint, Xk, ct, sealed, ctx, rnd)).toThrow(/does not verify/);
    expect(() => proveOpening(0n, Xk, ct, sealed, ctx, rnd)).toThrow(RangeError);
  });

  it('an opening is bound to the ciphertext and to the sealed proof it opens', () => {
    const opening = proveOpening(xT, Xk, ct, sealed, ctx, rnd);
    // A second sealed share of the same position to the same recipient: same D, other pair, other challenge.
    const twin = sealShare(xk, ct, XT, ctx, rnd);
    expect(verifyOpening(Xk, XT, ct, twin, opening, ctx)).toBe(null);
    // The same pair and proof under another ciphertext no longer verify at all.
    expect(verifyOpening(Xk, XT, other, sealed, opening, ctx)).toBe(null);
    expect(verifyOpening(Xk, XT, { a: ct.a, b: ct.b.add(G) }, sealed, opening, ctx)).toBe(null);
    expect(verifyOpening(Xk, XT, ct, sealed, opening, ctx)?.equals(ct.a.multiply(xk))).toBe(true);
  });

  it('hedged nonces: a constant random source still gives distinct, valid proofs per statement and secret', () => {
    const zero = (n: number): Uint8Array => new Uint8Array(n);
    const a = sealShare(xk, ct, XT, ctx, zero);
    const b = sealShare(xk, other, XT, { ...ctx, pos: 8 }, zero);
    const c = sealShare(secrets[0] as bigint, ct, XT, ctx, zero);
    const d = sealShare(xk, ct, keys[0] as Point, ctx, zero);
    expect(verifySealedShare(Xk, ct, XT, a, ctx)).toBe(true);
    expect(verifySealedShare(Xk, other, XT, b, { ...ctx, pos: 8 })).toBe(true);
    // Same broken source, different statement or secret: different r (A) and different commitments (c).
    const As = [a, b, c, d].map((x) => x.A.toHex());
    expect(new Set(As).size).toBe(4);
    expect(new Set([a, b, c, d].map((x) => x.c)).size).toBe(4);
    // With a constant source the same statement repeats exactly: no second response under the same nonce.
    const again = sealShare(xk, ct, XT, ctx, zero);
    expect(again.c === a.c && again.s1 === a.s1 && again.s2 === a.s2).toBe(true);
    const o1 = proveOpening(xT, Xk, ct, a, ctx, zero);
    const o2 = proveOpening(xT, Xk, other, b, { ...ctx, pos: 8 }, zero);
    expect(o1.c).not.toBe(o2.c);
    expect(verifyOpening(Xk, XT, ct, a, o1, ctx)?.equals(ct.a.multiply(xk))).toBe(true);
  });

  it('hedged nonces still use the random source: two draws give different pairs', () => {
    const x1 = sealShare(xk, ct, XT, ctx, seededRandom('h1'));
    const x2 = sealShare(xk, ct, XT, ctx, seededRandom('h2'));
    expect(x1.A.equals(x2.A)).toBe(false);
    expect(() => sealShare(xk, ct, XT, ctx, () => new Uint8Array(31))).toThrow(/wrong number of bytes/);
  });
});
