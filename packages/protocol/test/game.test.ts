import { createHash } from 'node:crypto';
import {
  type Ciphertext,
  encodeDeck,
  encodeScalar,
  encodeShare,
  encodeShuffleProof,
  G,
  initialDeck,
  jointKey,
  makeShare,
  proveShuffle,
  randomScalar,
  shuffleDeck,
  verifyShare,
  verifyShuffle,
} from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors.ts';
import {
  attestTemplate,
  logHash,
  type MoveContent,
  moveTemplate,
  type PosShare,
  parseAttest,
  parseMove,
  parseResign,
  parseSecret,
  parseShares,
  parseTimeout,
  resignTemplate,
  secretTemplate,
  sharesTemplate,
  timeoutTemplate,
} from '../src/game.ts';
import { KIND, MAX_EVENT_BYTES } from '../src/kinds.ts';
import { type EventTemplate, eventBytes, finalizeEvent, getPublicKey, type Hex } from '../src/nostr.ts';

function seededRandom(seed: string) {
  const rng = createRng(seed);
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

const rnd = seededRandom('protocol-game');
const sk = Uint8Array.from(createHash('sha256').update('session:a', 'utf8').digest());
const SESSION = getPublicKey(sk);
const sha = (s: string): Hex => createHash('sha256').update(s, 'utf8').digest('hex');
const ROOT = sha('root');
const PREV = sha('prev');
const HEAD = sha('head');
const T0 = 1_790_000_000;
const DECK = 'tiles';

function sign(t: EventTemplate) {
  return finalizeEvent(t, sk, rnd);
}

/** A real shuffle step of an `n`-card deck by seat 0 of 2, plus real shares at positions 0..n-1. */
function fixture(n: number) {
  const secrets = [randomScalar(rnd), randomScalar(rnd)] as const;
  const X = jointKey(secrets.map((x) => G.multiply(x)));
  const input = initialDeck(DECK, n);
  const { out, psi, rPrime } = shuffleDeck(input, X, rnd);
  const proof = proveShuffle(input, out, X, psi, rPrime, { rootId: ROOT, seat: 0, deckId: DECK }, rnd);
  const shares: PosShare[] = out.map((ct, pos) => ({
    pos,
    share: makeShare(secrets[0], ct, { rootId: ROOT, deckId: DECK, pos }, rnd),
  }));
  return { secrets, X, input, out, proof, shares };
}

const fx = fixture(8);
const share = (pos: number): PosShare => fx.shares[pos] as PosShare;
const SHUFFLE: MoveContent = { type: 'shuffle', deck: fx.out, proof: fx.proof };
const ACTION: MoveContent = {
  type: 'action',
  action: { actor: 0, type: 'endTurn', discard: [] },
  reveals: [share(1)],
  shares: [share(2), share(5)],
};
/** Move 1 follows the root; every later move follows another move. */
const moveSpec = (content: MoveContent, seq = 1) => ({
  rootId: ROOT,
  prevId: seq === 1 ? ROOT : PREV,
  seq,
  content,
});

/** The tags of a template, with `f` applied: the way tests build a malformed event. */
function withTags(t: EventTemplate, f: (tags: string[][]) => string[][]): EventTemplate {
  return { ...t, tags: f(t.tags.map((x) => [...x])) };
}

/** The code of the `ProtocolError` `f` throws, or `'accepted'`. Any other throw fails the test. */
function code(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    expect(e).toBeInstanceOf(ProtocolError);
    return (e as ProtocolError).code;
  }
  return 'accepted';
}

const rootTag = ['e', ROOT, '', 'root'];
const prevTag = ['e', PREV, '', 'prev'];

describe('Move (7452)', () => {
  const shuffleTpl = moveTemplate(moveSpec(SHUFFLE), T0);
  const actionTpl = moveTemplate(moveSpec(ACTION, 9), T0 + 5);
  const parse = (t: EventTemplate) => parseMove(sign(t), 8);

  it('has the section 4.4 tags', () => {
    expect(shuffleTpl.kind).toBe(KIND.move);
    expect(shuffleTpl.tags).toEqual([rootTag, ['e', ROOT, '', 'prev'], ['seq', '1'], ['proto', '1']]);
    expect(actionTpl.tags).toContainEqual(['seq', '9']);
  });

  it('round-trips a real shuffle step into decoded deck types, and its proof still verifies', () => {
    const ev = sign(shuffleTpl);
    const m = parseMove(ev, 8);
    expect(m).toMatchObject({
      id: ev.id,
      pubkey: SESSION,
      createdAt: T0,
      rootId: ROOT,
      prevId: ROOT,
      seq: 1,
    });
    if (m.content.type !== 'shuffle') throw new Error('expected a shuffle');
    expect(m.content.deck).toHaveLength(8);
    const ctx = { rootId: ROOT, seat: 0, deckId: DECK };
    expect(verifyShuffle(fx.input, m.content.deck, fx.X, m.content.proof, ctx)).toBe(true);
    expect(encodeDeck(m.content.deck)).toEqual(encodeDeck(fx.out));
    expect(encodeShuffleProof(m.content.proof)).toEqual(encodeShuffleProof(fx.proof));
  });

  it('round-trips an action with real reveals and shares', () => {
    const m = parseMove(sign(actionTpl), 8);
    expect(m.seq).toBe(9);
    expect(m.content).toMatchObject({ type: 'action', action: { actor: 0, type: 'endTurn', discard: [] } });
    if (m.content.type !== 'action') throw new Error('expected an action');
    expect(m.content.reveals.map((r) => r.pos)).toEqual([1]);
    expect(m.content.shares.map((r) => r.pos)).toEqual([2, 5]);
    const s = m.content.shares[0] as PosShare;
    const ctx = { rootId: ROOT, deckId: DECK, pos: s.pos };
    expect(verifyShare(G.multiply(fx.secrets[0]), fx.out[s.pos] as Ciphertext, s.share, ctx)).toBe(true);
  });

  it('accepts empty reveals and shares', () => {
    const t = moveTemplate(moveSpec({ type: 'action', action: {}, reveals: [], shares: [] }), T0);
    expect(code(() => parse(t))).toBe('accepted');
  });

  it('accepts a real 108-card shuffle step under the size cap', { timeout: 60_000 }, () => {
    const big = fixture(108);
    const ev = sign(moveTemplate(moveSpec({ type: 'shuffle', deck: big.out, proof: big.proof }), T0));
    expect(eventBytes(ev)).toBeGreaterThan(30_000);
    expect(eventBytes(ev)).toBeLessThan(MAX_EVENT_BYTES);
    const m = parseMove(ev, 108);
    expect(m.content.type === 'shuffle' && m.content.deck.length).toBe(108);
  });

  it('rejects an oversized event before anything else', () => {
    const t = { ...actionTpl, content: ' '.repeat(MAX_EVENT_BYTES) };
    expect(code(() => parse(t))).toBe('too-large');
  });

  it('rejects the wrong kind', () => {
    expect(code(() => parse({ ...shuffleTpl, kind: KIND.shares }))).toBe('wrong-kind');
  });

  it('rejects a missing or doubled proto tag', () => {
    expect(code(() => parse(withTags(shuffleTpl, (t) => t.filter((x) => x[0] !== 'proto'))))).toBe(
      'bad-proto',
    );
    expect(code(() => parse(withTags(shuffleTpl, (t) => [...t, ['proto', '1']])))).toBe('bad-proto');
  });

  describe('tags', () => {
    const bad = (name: string, f: (tags: string[][]) => string[][]) =>
      it(`rejects ${name}`, () => expect(code(() => parse(withTags(shuffleTpl, f)))).toBe('bad-tag'));
    bad('a missing prev', (t) => t.filter((x) => x[3] !== 'prev'));
    bad('a missing root', (t) => t.filter((x) => x[3] !== 'root'));
    bad('two root tags', (t) => [...t.filter((x) => x[3] !== 'prev'), ['e', PREV, '', 'root']]);
    bad('two prev tags', (t) => [...t, ['e', HEAD, '', 'prev']]);
    bad('a third e tag', (t) => [...t, ['e', HEAD, '', 'head']]);
    bad('an e tag without a marker', (t) => [...t, ['e', HEAD]]);
    bad('a relay hint on root', (t) =>
      t.map((x) => (x[3] === 'root' ? ['e', ROOT, 'wss://r.example', 'root'] : x)),
    );
    bad('a short root tag', (t) => t.map((x) => (x[3] === 'root' ? ['e', ROOT] : x)));
    bad('a rootId that is not hex', (t) => t.map((x) => (x[3] === 'root' ? ['e', 'zz', '', 'root'] : x)));
    bad('an uppercase rootId', (t) =>
      t.map((x) => (x[3] === 'root' ? ['e', ROOT.toUpperCase(), '', 'root'] : x)),
    );
    bad('a 63-character prevId', (t) =>
      t.map((x) => (x[3] === 'prev' ? ['e', PREV.slice(1), '', 'prev'] : x)),
    );
    it('rejects seq above 1 when prev is the root', () => {
      const t = moveTemplate({ ...moveSpec(SHUFFLE, 5), prevId: ROOT }, T0);
      expect(code(() => parse(t))).toBe('bad-tag');
    });
    it('rejects seq 1 when prev is not the root', () => {
      const t = moveTemplate({ ...moveSpec(SHUFFLE, 1), prevId: PREV }, T0);
      expect(code(() => parse(t))).toBe('bad-tag');
    });
    bad('a missing seq', (t) => t.filter((x) => x[0] !== 'seq'));
    bad('two seq tags', (t) => [...t, ['seq', '2']]);
    for (const seq of ['0', '01', '-1', '1.5', '1e2', '', ' 1', '+1', '9007199254740993'])
      bad(`seq ${JSON.stringify(seq)}`, (t) => t.map((x) => (x[0] === 'seq' ? ['seq', seq] : x)));
    it('ignores tags it does not know', () => {
      const t = withTags(shuffleTpl, (tags) => [...tags, ['client', 'x'], ['alt', 'a move']]);
      expect(code(() => parse(t))).toBe('accepted');
    });
  });

  describe('content', () => {
    const bad = (name: string, content: unknown, tpl = shuffleTpl) =>
      it(`rejects ${name}`, () => {
        const text = typeof content === 'string' ? content : canonicalJson(content);
        expect(code(() => parse({ ...tpl, content: text }))).toBe('bad-content');
      });
    const good = JSON.parse(shuffleTpl.content) as Record<string, unknown>;
    const goodAction = JSON.parse(actionTpl.content) as Record<string, unknown>;
    const sh = (i: number) => encodeShare(share(i));
    const act = (over: Record<string, unknown>) => ({ ...goodAction, ...over });

    bad('content that is not JSON', 'nope');
    bad('content that is not canonical', JSON.stringify(good, null, 1));
    bad('a non-object', []);
    bad('an unknown type', { ...good, type: 'other' });
    bad('a missing type', { deck: good.deck, proof: good.proof });
    bad('an extra key on a shuffle', { ...good, extra: 1 });
    bad('a deck of the wrong size', { ...good, deck: (good.deck as unknown[]).slice(1) });
    bad('a bad deck point', { ...good, deck: [['x', 'y'], ...(good.deck as unknown[]).slice(1)] });
    bad('a proof that is not an object', { ...good, proof: 'p' });
    bad('a proof for another size', {
      ...good,
      proof: JSON.parse(canonicalJson(encodeShuffleProof(fixture(4).proof))),
    });
    bad('an action that is not an object', act({ action: 3 }));
    bad('a null action', act({ action: null }));
    bad('an array action', act({ action: [] }));
    bad('an extra key on an action', act({ extra: 1 }));
    bad('a missing shares list', { action: goodAction.action, reveals: [], type: 'action' });
    bad('unsorted shares', act({ shares: [sh(5), sh(2)] }));
    bad('duplicate share positions', act({ shares: [sh(2), sh(2)] }));
    bad('unsorted reveals', act({ reveals: [sh(5), sh(1)] }));
    bad('duplicate reveal positions', act({ reveals: [sh(1), sh(1)] }));
    bad('a share with an extra key', act({ shares: [{ ...sh(2), extra: 1 }] }));
    bad('a share with a negative pos', act({ shares: [{ ...sh(2), pos: -1 }] }));
    bad('shares that are not a list', act({ shares: {} }));
    it('takes the deck size from the caller, not the message', () => {
      expect(code(() => parseMove(sign(shuffleTpl), 7))).toBe('bad-content');
    });
  });

  it('never throws anything but ProtocolError on junk', () => {
    for (const junk of [null, undefined, 1, 'x', [], {}, { kind: 7452 }]) {
      expect(code(() => parseMove(junk, 8))).toBe('invalid-event');
    }
  });
});

describe('Shares (7453)', () => {
  const tpl = sharesTemplate({ rootId: ROOT, shares: [share(0), share(3), share(7)] }, T0);
  const parse = (t: EventTemplate) => parseShares(sign(t));

  it('has the root tag only', () => {
    expect(tpl.kind).toBe(KIND.shares);
    expect(tpl.tags).toEqual([rootTag, ['proto', '1']]);
  });

  it('round-trips real shares', () => {
    const ev = sign(tpl);
    const s = parseShares(ev);
    expect(s).toMatchObject({ id: ev.id, pubkey: SESSION, createdAt: T0, rootId: ROOT });
    expect(s.shares.map((x) => x.pos)).toEqual([0, 3, 7]);
    const x = s.shares[1] as PosShare;
    const ctx = { rootId: ROOT, deckId: DECK, pos: 3 };
    expect(verifyShare(G.multiply(fx.secrets[0]), fx.out[3] as Ciphertext, x.share, ctx)).toBe(true);
  });

  it('rejects unsorted shares', () => {
    const t = sharesTemplate({ rootId: ROOT, shares: [share(3), share(0)] }, T0);
    expect(code(() => parse(t))).toBe('bad-content');
  });

  it('rejects duplicate positions', () => {
    const t = sharesTemplate({ rootId: ROOT, shares: [share(3), share(3)] }, T0);
    expect(code(() => parse(t))).toBe('bad-content');
  });

  it('rejects the wrong kind, a missing root and extra e tags', () => {
    expect(code(() => parse({ ...tpl, kind: KIND.move }))).toBe('wrong-kind');
    expect(code(() => parse(withTags(tpl, (t) => t.slice(1))))).toBe('bad-tag');
    expect(code(() => parse(withTags(tpl, (t) => [...t, prevTag])))).toBe('bad-tag');
    expect(code(() => parse(withTags(tpl, (t) => [...t, rootTag])))).toBe('bad-tag');
    expect(
      code(() => parse(withTags(tpl, (t) => t.map((x) => (x[0] === 'e' ? ['e', 'abc', '', 'root'] : x))))),
    ).toBe('bad-tag');
  });

  it('rejects other content shapes', () => {
    const body = JSON.parse(tpl.content) as Record<string, unknown>;
    for (const c of [
      { ...body, extra: 1 },
      { ...body, type: 'move' },
      { shares: body.shares },
      { type: 'shares' },
      [],
    ]) {
      expect(code(() => parse({ ...tpl, content: canonicalJson(c) }))).toBe('bad-content');
    }
    expect(code(() => parse({ ...tpl, content: `${tpl.content} ` }))).toBe('bad-content');
  });
});

describe('Timeout claim (7454)', () => {
  const tpl = timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 2 }, T0);
  const parse = (t: EventTemplate) => parseTimeout(sign(t));

  it('has root, head and seat tags and empty content', () => {
    expect(tpl.kind).toBe(KIND.timeout);
    expect(tpl.tags).toEqual([rootTag, ['e', HEAD, '', 'head'], ['seat', '2'], ['proto', '1']]);
    expect(tpl.content).toBe('{}');
  });

  it('round-trips', () => {
    const ev = sign(tpl);
    expect(parseTimeout(ev)).toEqual({
      id: ev.id,
      pubkey: SESSION,
      createdAt: T0,
      rootId: ROOT,
      headId: HEAD,
      seat: 2,
    });
    expect(parse(timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 0 }, T0)).seat).toBe(0);
  });

  const bad = (name: string, f: (tags: string[][]) => string[][]) =>
    it(`rejects ${name}`, () => expect(code(() => parse(withTags(tpl, f)))).toBe('bad-tag'));
  bad('a missing head', (t) => t.filter((x) => x[3] !== 'head'));
  bad('a missing root', (t) => t.filter((x) => x[3] !== 'root'));
  bad('two root tags', (t) => t.map((x) => (x[3] === 'head' ? ['e', HEAD, '', 'root'] : x)));
  bad('a prev tag', (t) => [...t, prevTag]);
  bad('a head that is not hex', (t) => t.map((x) => (x[3] === 'head' ? ['e', 'nope', '', 'head'] : x)));
  bad('a missing seat', (t) => t.filter((x) => x[0] !== 'seat'));
  bad('two seats', (t) => [...t, ['seat', '1']]);
  for (const seat of ['-1', '01', '1.0', '', 'x'])
    bad(`seat ${JSON.stringify(seat)}`, (t) => t.map((x) => (x[0] === 'seat' ? ['seat', seat] : x)));

  it('rejects the wrong kind and non-empty content', () => {
    expect(code(() => parse({ ...tpl, kind: KIND.reveal }))).toBe('wrong-kind');
    expect(code(() => parse({ ...tpl, content: '{"a":1}' }))).toBe('bad-content');
    expect(code(() => parse({ ...tpl, content: '' }))).toBe('bad-content');
  });
});

describe('Resign (7457)', () => {
  const tpl = resignTemplate({ rootId: ROOT, headId: HEAD }, T0);
  const parse = (t: EventTemplate) => parseResign(sign(t), false);

  it('has root and head tags and, without a deck, the bare resign content', () => {
    expect(tpl.kind).toBe(KIND.resign);
    expect(KIND.resign).toBe(7457);
    expect(tpl.tags).toEqual([rootTag, ['e', HEAD, '', 'head'], ['proto', '1']]);
    expect(tpl.content).toBe('{"type":"resign"}');
    // A null secret is the deckless form too, byte for byte.
    expect(resignTemplate({ rootId: ROOT, headId: HEAD, secret: null }, T0)).toEqual(tpl);
  });

  it('round-trips, the root itself being a valid head', () => {
    const ev = sign(tpl);
    expect(parseResign(ev, false)).toEqual({
      id: ev.id,
      pubkey: SESSION,
      createdAt: T0,
      rootId: ROOT,
      headId: HEAD,
      secret: null,
    });
    expect(parse(resignTemplate({ rootId: ROOT, headId: ROOT }, T0)).headId).toBe(ROOT);
  });

  const bad = (name: string, f: (tags: string[][]) => string[][]) =>
    it(`rejects ${name}`, () => expect(code(() => parse(withTags(tpl, f)))).toBe('bad-tag'));
  bad('a missing head', (t) => t.filter((x) => x[3] !== 'head'));
  bad('a missing root', (t) => t.filter((x) => x[3] !== 'root'));
  bad('two head tags', (t) => [...t, ['e', ROOT, '', 'head']]);
  bad('a prev tag', (t) => [...t, prevTag]);
  bad('a head that is not hex', (t) => t.map((x) => (x[3] === 'head' ? ['e', 'nope', '', 'head'] : x)));

  it('rejects the wrong kind, a missing proto tag and any other content', () => {
    expect(code(() => parse({ ...tpl, kind: KIND.timeout }))).toBe('wrong-kind');
    expect(code(() => parse(withTags(tpl, (t) => t.filter((x) => x[0] !== 'proto'))))).toBe('bad-proto');
    expect(code(() => parse({ ...tpl, content: '{}' }))).toBe('bad-content');
    expect(code(() => parse({ ...tpl, content: '{"type":"forfeit"}' }))).toBe('bad-content');
    expect(code(() => parse({ ...tpl, content: '{"seat":0,"type":"resign"}' }))).toBe('bad-content');
    expect(code(() => parse({ ...tpl, content: '{ "type":"resign"}' }))).toBe('bad-content');
    expect(code(() => parse({ ...tpl, content: '' }))).toBe('bad-content');
  });

  describe('with a deck (D052): the content carries the deck secret', () => {
    const x = fx.secrets[0];
    const deckTpl = resignTemplate({ rootId: ROOT, headId: HEAD, secret: x }, T0);
    const parseDeck = (t: EventTemplate) => parseResign(sign(t), true);
    const put = (c: unknown) => ({ ...deckTpl, content: canonicalJson(c) });

    it('writes the secret as an encoded scalar, keys sorted', () => {
      expect(deckTpl.tags).toEqual(tpl.tags);
      expect(deckTpl.content).toBe(`{"secret":"${encodeScalar(x)}","type":"resign"}`);
    });

    it('round-trips the secret, which still matches its public key', () => {
      const ev = sign(deckTpl);
      const r = parseResign(ev, true);
      expect(r).toEqual({
        id: ev.id,
        pubkey: SESSION,
        createdAt: T0,
        rootId: ROOT,
        headId: HEAD,
        secret: x,
      });
      expect(G.multiply(r.secret as bigint).equals(G.multiply(x))).toBe(true);
    });

    it('accepts exactly one form per game: a secret is required with a deck and forbidden without', () => {
      expect(code(() => parseDeck(tpl))).toBe('bad-content');
      expect(code(() => parse(deckTpl))).toBe('bad-content');
    });

    it('rejects a scalar at or above the group order, junk, a non-canonical encoding and extra keys', () => {
      expect(code(() => parseDeck(put({ secret: encodeScalar(5n), type: 'resign' })))).toBe('accepted');
      expect(code(() => parseDeck(put({ secret: '_'.repeat(43), type: 'resign' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ secret: 5, type: 'resign' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ secret: null, type: 'resign' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ secret: 'short', type: 'resign' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ secret: `${encodeScalar(x)}=`, type: 'resign' })))).toBe(
        'bad-content',
      );
      expect(code(() => parseDeck(put({ secret: encodeScalar(x), type: 'forfeit' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ deckSecret: encodeScalar(x), type: 'resign' })))).toBe('bad-content');
      expect(code(() => parseDeck(put({ extra: 1, secret: encodeScalar(x), type: 'resign' })))).toBe(
        'bad-content',
      );
      expect(code(() => parseDeck({ ...deckTpl, content: ` ${deckTpl.content}` }))).toBe('bad-content');
    });
  });
});

describe('Secret reveal (7455)', () => {
  const x = fx.secrets[0];
  const tpl = secretTemplate({ rootId: ROOT, deckSecret: x }, T0);
  const parse = (t: EventTemplate) => parseSecret(sign(t));
  const put = (c: unknown) => ({ ...tpl, content: canonicalJson(c) });

  it('has the root tag only and the scalar content', () => {
    expect(tpl.kind).toBe(KIND.reveal);
    expect(tpl.tags).toEqual([rootTag, ['proto', '1']]);
    expect(tpl.content).toBe(canonicalJson({ deckSecret: encodeScalar(x) }));
  });

  it('round-trips the secret, which still matches its public key', () => {
    const ev = sign(tpl);
    const s = parseSecret(ev);
    expect(s).toEqual({ id: ev.id, pubkey: SESSION, createdAt: T0, rootId: ROOT, deckSecret: x });
    expect(G.multiply(s.deckSecret).equals(G.multiply(x))).toBe(true);
  });

  it('rejects a scalar at or above the group order, junk and extra keys', () => {
    expect(code(() => parse(put({ deckSecret: encodeScalar(5n) })))).toBe('accepted');
    expect(code(() => parse(put({ deckSecret: '_'.repeat(43) })))).toBe('bad-content');
    expect(code(() => parse(put({ deckSecret: 5 })))).toBe('bad-content');
    expect(code(() => parse(put({ deckSecret: 'short' })))).toBe('bad-content');
    expect(code(() => parse(put({ deckSecret: encodeScalar(x), extra: 1 })))).toBe('bad-content');
    expect(code(() => parse(put({})))).toBe('bad-content');
  });

  it('rejects the wrong kind and extra e tags', () => {
    expect(code(() => parse({ ...tpl, kind: KIND.attest }))).toBe('wrong-kind');
    expect(code(() => parse(withTags(tpl, (t) => [...t, prevTag])))).toBe('bad-tag');
    expect(code(() => parse(withTags(tpl, (t) => t.slice(1))))).toBe('bad-tag');
  });
});

describe('Result attestation (7456)', () => {
  const spec = {
    rootId: ROOT,
    audit: 'pass' as const,
    logHash: logHash([PREV, HEAD]),
    outcome: { places: [1, 2, 2], reason: 'declared', scores: [120, -5, 0] },
  };
  const tpl = attestTemplate(spec, T0);
  const parse = (t: EventTemplate) => parseAttest(sign(t));
  const withContent = (c: unknown) => ({ ...tpl, content: canonicalJson(c) });
  const body = JSON.parse(tpl.content) as Record<string, unknown>;
  const outcome = (o: Record<string, unknown>) =>
    withContent({ ...body, outcome: { ...spec.outcome, ...o } });
  const audit = (a: unknown) => withContent({ ...body, audit: a });

  it('has the root tag only', () => {
    expect(tpl.kind).toBe(KIND.attest);
    expect(tpl.tags).toEqual([rootTag, ['proto', '1']]);
  });

  it('round-trips a pass', () => {
    const ev = sign(tpl);
    expect(parseAttest(ev)).toEqual({ id: ev.id, pubkey: SESSION, createdAt: T0, ...spec });
  });

  it('round-trips a failed audit', () => {
    const a = { fail: [0, 2], reason: 'bad shuffle by seat 0' };
    expect(parse(attestTemplate({ ...spec, audit: a }, T0)).audit).toEqual(a);
  });

  it('rejects bad audits', () => {
    const rejected = (a: unknown) => expect(code(() => parse(audit(a)))).toBe('bad-content');
    rejected('fail');
    rejected({ fail: [], reason: 'x' });
    rejected({ fail: [2, 0], reason: 'x' });
    rejected({ fail: [1, 1], reason: 'x' });
    rejected({ fail: [-1], reason: 'x' });
    rejected({ fail: [0.5], reason: 'x' });
    rejected({ fail: ['0'], reason: 'x' });
    rejected({ fail: [0], reason: '' });
    rejected({ fail: [0], reason: 'x'.repeat(501) });
    rejected({ fail: [0], reason: '\u{1F600}'.repeat(501) });
    rejected({ fail: [0] });
    rejected({ fail: [0], reason: 'x', extra: 1 });
    rejected(null);
    rejected(true);
    expect(code(() => parse(audit({ fail: [0], reason: 'x'.repeat(500) })))).toBe('accepted');
    // 300 emoji are 600 UTF-16 units but 300 code points.
    expect(code(() => parse(audit({ fail: [0], reason: '\u{1F600}'.repeat(300) })))).toBe('accepted');
  });

  it('rejects a bad logHash', () => {
    for (const h of ['', 'AB'.repeat(32), spec.logHash.slice(1), 5, null])
      expect(code(() => parse(withContent({ ...body, logHash: h })))).toBe('bad-content');
  });

  it('round-trips an unrated outcome that records who ended the game (D052)', () => {
    const o = { ...spec.outcome, unrated: true as const, endedBy: { type: 'resign' as const, seat: 2 } };
    const t = attestTemplate({ ...spec, outcome: o }, T0);
    expect(t.content).toBe(
      canonicalJson({
        audit: 'pass',
        logHash: spec.logHash,
        outcome: {
          endedBy: { seat: 2, type: 'resign' },
          places: o.places,
          reason: o.reason,
          scores: o.scores,
          unrated: true,
        },
      }),
    );
    expect(parse(t).outcome).toEqual(o);
    // Without the fields, the content is exactly the old three keys.
    expect(JSON.parse(tpl.content).outcome).toEqual(spec.outcome);
    expect(Object.keys(parse(tpl).outcome)).toEqual(['places', 'reason', 'scores']);
  });

  it('rejects malformed unrated and endedBy fields, and either one alone', () => {
    const rejected = (o: Record<string, unknown>) =>
      expect(code(() => parse(outcome(o)))).toBe('bad-content');
    const by = { type: 'resign', seat: 1 };
    expect(code(() => parse(outcome({ unrated: true, endedBy: by })))).toBe('accepted');
    // D056 fix round 2: an end that holds only because a deck secret froze its fork records the forker.
    expect(code(() => parse(outcome({ unrated: true, endedBy: { type: 'fork', seat: 2 } })))).toBe(
      'accepted',
    );
    rejected({ unrated: true });
    rejected({ endedBy: by });
    rejected({ unrated: false, endedBy: by });
    rejected({ unrated: 1, endedBy: by });
    rejected({ unrated: true, endedBy: null });
    rejected({ unrated: true, endedBy: { type: 'timeout', seat: 1 } });
    rejected({ unrated: true, endedBy: { type: 'resign', seat: 3 } });
    rejected({ unrated: true, endedBy: { type: 'resign', seat: -1 } });
    rejected({ unrated: true, endedBy: { type: 'resign', seat: 0.5 } });
    rejected({ unrated: true, endedBy: { type: 'resign', seat: '1' } });
    rejected({ unrated: true, endedBy: { type: 'resign' } });
    rejected({ unrated: true, endedBy: { ...by, extra: 1 } });
    rejected({ unrated: true, endedBy: by, extra: 1 });
  });

  it('rejects bad outcomes', () => {
    const rejected = (t: EventTemplate) => expect(code(() => parse(t))).toBe('bad-content');
    rejected(outcome({ places: [1, 2] }));
    rejected(outcome({ scores: [1] }));
    rejected(outcome({ places: [0, 1, 2] }));
    rejected(outcome({ places: [1.5, 1, 2] }));
    rejected(outcome({ scores: [1.5, 0, 0] }));
    rejected(outcome({ scores: [2 ** 53, 0, 0] }));
    rejected(outcome({ scores: ['1', 0, 0] }));
    rejected(outcome({ reason: 5 }));
    rejected(outcome({ extra: 1 }));
    rejected(withContent({ ...body, outcome: [] }));
    rejected(withContent({ ...body, extra: 1 }));
    rejected(withContent({ audit: 'pass', logHash: spec.logHash }));
  });

  it('rejects the wrong kind, non-canonical content and extra e tags', () => {
    expect(code(() => parse({ ...tpl, kind: KIND.shares }))).toBe('wrong-kind');
    expect(code(() => parse({ ...tpl, content: JSON.stringify(body, null, 1) }))).toBe('bad-content');
    expect(code(() => parse(withTags(tpl, (t) => [...t, prevTag])))).toBe('bad-tag');
  });
});

describe('logHash', () => {
  it('is the SHA-256 of the ids joined with newlines', () => {
    expect(logHash([PREV, HEAD])).toBe(sha(`${PREV}\n${HEAD}`));
    expect(logHash([PREV])).toBe(sha(PREV));
  });
  it('hashes the empty string for an empty log', () => {
    expect(logHash([])).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('depends on order', () => {
    expect(logHash([PREV, HEAD])).not.toBe(logHash([HEAD, PREV]));
  });
});
