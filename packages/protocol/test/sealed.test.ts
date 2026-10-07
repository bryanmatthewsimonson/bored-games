import { createHash } from 'node:crypto';
import { G, initialDeck, randomScalar, reEncrypt, sealShare, verifySealedShare } from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors.ts';
import { parseSealed, sealedTemplate } from '../src/game.ts';
import { KIND } from '../src/kinds.ts';
import { finalizeEvent, type Hex } from '../src/nostr.ts';

function seededRandom(seed: string) {
  const rng = createRng(seed);
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

const rnd = seededRandom('protocol-sealed');
const sk = Uint8Array.from(createHash('sha256').update('session:sealed', 'utf8').digest());
const ROOT = createHash('sha256').update('root', 'utf8').digest('hex') as Hex;
const T0 = 1_790_000_000;

describe('the Sealed event (kind 7458, PROTOCOL §4.10)', () => {
  const x = randomScalar(rnd);
  const xT = randomScalar(rnd);
  const plain = initialDeck('rail', 3)[1];
  if (plain === undefined) throw new Error('no card');
  const ct = reEncrypt(plain, G.multiply(randomScalar(rnd)), randomScalar(rnd));
  const ctx = { rootId: ROOT, deckId: 'rail', pos: 1 };
  const sealed = sealShare(x, ct, G.multiply(xT), ctx, rnd);

  it('round-trips through the template and the strict parser', () => {
    expect(KIND.sealed).toBe(7458);
    const ev = finalizeEvent(
      sealedTemplate({ rootId: ROOT, sealed: [{ pos: 1, to: 2, sealed }] }, T0),
      sk,
      rnd,
    );
    const p = parseSealed(ev);
    expect(p.rootId).toBe(ROOT);
    expect(p.sealed.map((s) => [s.pos, s.to])).toEqual([[1, 2]]);
    expect(
      verifySealedShare(G.multiply(x), ct, G.multiply(xT), p.sealed[0]?.sealed as typeof sealed, ctx),
    ).toBe(true);
  });

  it('rejects an empty list, unsorted or repeated shares and extra fields', () => {
    const bad = (content: unknown) =>
      finalizeEvent(
        {
          kind: KIND.sealed,
          created_at: T0,
          tags: [
            ['e', ROOT, '', 'root'],
            ['proto', '1'],
          ],
          content: canonicalJson(content),
        },
        sk,
        rnd,
      );
    const one = JSON.parse(
      finalizeEvent(sealedTemplate({ rootId: ROOT, sealed: [{ pos: 1, to: 2, sealed }] }, T0), sk, rnd)
        .content,
    ).sealed[0];
    expect(() => parseSealed(bad({ sealed: [], type: 'sealed' }))).toThrow(ProtocolError);
    expect(() => parseSealed(bad({ sealed: [one, one], type: 'sealed' }))).toThrow(ProtocolError);
    expect(() => parseSealed(bad({ sealed: [{ ...one, pos: 2 }, one], type: 'sealed' }))).toThrow(
      ProtocolError,
    );
    expect(() => parseSealed(bad({ extra: 1, sealed: [one], type: 'sealed' }))).toThrow(ProtocolError);
    expect(() => parseSealed(bad({ sealed: [one], type: 'shares' }))).toThrow(ProtocolError);
    expect(parseSealed(bad({ sealed: [one, { ...one, to: 3 }], type: 'sealed' })).sealed).toHaveLength(2);
  });
});
