import { createHash } from 'node:crypto';
import { encodeShare, G, initialDeck, makeShare, randomScalar, shuffleDeck } from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors.ts';
import {
  attestTemplate,
  cardSharesTemplate,
  deviceNoteTemplate,
  endAttestTemplate,
  moveTemplate,
  type PosShare,
  parseAttest,
  parseAttestV2,
  parseDeviceNote,
  parseMove,
  parseResign,
  parseSecret,
  parseShares,
  parseSharesV2,
  parseTimeout,
  resignTemplate,
  rollSharesTemplate,
  secretTemplate,
  sharesTemplate,
  timeoutTemplate,
} from '../src/game.ts';
import { KIND } from '../src/kinds.ts';
import { joinTemplate, parseRoot, parseTable, rootTemplate, tableTemplate } from '../src/lobby.ts';
import { type EventTemplate, finalizeEvent, getPublicKey, type Hex, type NostrEvent } from '../src/nostr.ts';

/* Protocol 2 events and the proto tag (PROTOCOL-v2 §2, §4; build plan T3). */

function seededRandom(seed: string) {
  const rng = createRng(seed);
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

const rnd = seededRandom('protocol-game-v2');
const sha = (s: string): Hex => createHash('sha256').update(s, 'utf8').digest('hex');
const keyOf = (s: string): Uint8Array => Uint8Array.from(createHash('sha256').update(s, 'utf8').digest());
const SESSION_SK = keyOf('v2:session');
const NPUB_SK = keyOf('v2:npub');
const ROOT = sha('root');
const HEAD = sha('head');
const MOVE = sha('move');
const LOG = sha('log');
const T0 = 1_790_000_000;

const x = randomScalar(rnd);
const deck = shuffleDeck(initialDeck('tiles', 8), G.multiply(x), rnd).out;
const share = (pos: number): PosShare => ({
  pos,
  share: makeShare(x, deck[pos] as (typeof deck)[number], { rootId: ROOT, deckId: 'tiles', pos }, rnd),
});
const wire = (pos: number) => encodeShare(share(pos));

const sign = (t: EventTemplate, sk = SESSION_SK): NostrEvent => finalizeEvent(t, sk, rnd);
const tagged = (t: EventTemplate, tags: (old: string[][]) => string[][]): EventTemplate => ({
  ...t,
  tags: tags(t.tags.map((tag) => [...tag])),
});
const withContent = (t: EventTemplate, c: unknown): EventTemplate => ({ ...t, content: canonicalJson(c) });
const protoTags = (t: EventTemplate) => t.tags.filter((tag) => tag[0] === 'proto');

function code(f: () => unknown): string {
  try {
    f();
    return 'accepted';
  } catch (e) {
    if (e instanceof ProtocolError) return e.code;
    throw e;
  }
}

const CARD_SHARES = [share(1), share(4)];
const card = cardSharesTemplate({ rootId: ROOT, anchorId: HEAD, shares: CARD_SHARES }, T0);
const roll = rollSharesTemplate(
  { rootId: ROOT, anchorId: HEAD, moveId: MOVE, shares: [share(0), share(2)] },
  T0,
);
const endOf = (kind: 'over' | 'claim' | 'resign', forfeit: number[]) =>
  endAttestTemplate({ rootId: ROOT, headId: HEAD, end: { kind, forfeit, logHash: LOG } }, T0);
const over = endOf('over', []);
const OUTCOME = { places: [1, 2], reason: 'over', scores: [3, 1] };
const stats = attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: OUTCOME }, T0, '2');
const DEVICE = sha('device').slice(0, 32);
const note = deviceNoteTemplate({ rootId: ROOT, device: DEVICE, n: 1 }, T0);
const ACTION = { type: 'action' as const, action: { type: 'pass', actor: 0 }, reveals: [], shares: [] };

describe('templates and the proto tag', () => {
  it('V2-01 every protocol template at proto 2 carries exactly one ["proto","2"] tag', () => {
    const lobby = {
      tableId: 't1',
      game: 'chess',
      version: '0.1.0',
      seats: 2,
      deadline: 259200,
      invited: [],
      open: 1,
      relays: ['wss://relay.example.com'],
      status: 'open' as const,
      rules: {},
      proto: '2' as const,
    };
    const tableEv = sign(tableTemplate(lobby, T0), NPUB_SK);
    const table = parseTable(tableEv);
    const joinT = joinTemplate(
      {
        tableAddress: table.address,
        creator: table.creator,
        deckKey: G.multiply(x),
        pok: { c: 1n, s: 1n },
        relays: lobby.relays,
        session: getPublicKey(SESSION_SK),
        sessionSig: '0'.repeat(128),
        rulesHash: sha('rules'),
        version: '0.1.0',
        proto: '2',
      },
      T0,
    );
    const templates: [string, EventTemplate][] = [
      ['table', tableTemplate(lobby, T0)],
      ['join', joinT],
      ['root (from the table)', rootTemplate({ table, joins: [], rules: {}, relays: lobby.relays }, T0)],
      ['move', moveTemplate({ rootId: ROOT, prevId: HEAD, seq: 3, content: ACTION }, T0, '2')],
      ['card shares', card],
      ['roll shares', roll],
      ['timeout claim', timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 1 }, T0, '2')],
      ['secret reveal', secretTemplate({ rootId: ROOT, deckSecret: x }, T0, '2')],
      ['resign', resignTemplate({ rootId: ROOT, headId: HEAD }, T0, '2')],
      ['end attestation', over],
      ['stats attestation', stats],
      ['device note', note],
    ];
    for (const [name, t] of templates) expect(protoTags(t), name).toEqual([['proto', '2']]);
    expect(table.proto).toBe('2');
  });

  it('every shared template still defaults to ["proto","1"], so v1 callers are unchanged', () => {
    const v1: EventTemplate[] = [
      moveTemplate({ rootId: ROOT, prevId: HEAD, seq: 3, content: ACTION }, T0),
      sharesTemplate({ rootId: ROOT, shares: [share(1)] }, T0),
      timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 1 }, T0),
      secretTemplate({ rootId: ROOT, deckSecret: x }, T0),
      resignTemplate({ rootId: ROOT, headId: HEAD }, T0),
      attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: OUTCOME }, T0),
    ];
    for (const t of v1) expect(protoTags(t)).toEqual([['proto', '1']]);
  });

  it('V2-02 in-game parsers reject a proto other than the game\'s, "3", and two proto tags', () => {
    const shared: [string, EventTemplate, (ev: unknown, p: '1' | '2') => unknown][] = [
      [
        'move',
        moveTemplate({ rootId: ROOT, prevId: HEAD, seq: 3, content: ACTION }, T0),
        (e, p) => parseMove(e, 8, p),
      ],
      ['timeout', timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 1 }, T0), (e, p) => parseTimeout(e, p)],
      ['secret', secretTemplate({ rootId: ROOT, deckSecret: x }, T0), (e, p) => parseSecret(e, p)],
      ['resign', resignTemplate({ rootId: ROOT, headId: HEAD }, T0), (e, p) => parseResign(e, false, p)],
    ];
    const at = (t: EventTemplate, tags: string[][]) =>
      sign(tagged(t, (old) => [...old.filter((tag) => tag[0] !== 'proto'), ...tags]));
    for (const [name, t, parse] of shared) {
      for (const game of ['1', '2'] as const) {
        const other = game === '1' ? '2' : '1';
        expect(
          code(() => parse(at(t, [['proto', game]]), game)),
          `${name} at its game's proto`,
        ).toBe('accepted');
        expect(
          code(() => parse(at(t, [['proto', other]]), game)),
          `${name}: another proto`,
        ).toBe('bad-proto');
        expect(
          code(() => parse(at(t, [['proto', '3']]), game)),
          `${name}: "3"`,
        ).toBe('bad-proto');
        expect(
          code(() =>
            parse(
              at(t, [
                ['proto', game],
                ['proto', game],
              ]),
              game,
            ),
          ),
          `${name}: two`,
        ).toBe('bad-proto');
        expect(
          code(() =>
            parse(
              at(t, [
                ['proto', '1'],
                ['proto', '2'],
              ]),
              game,
            ),
          ),
          `${name}: 1 and 2`,
        ).toBe('bad-proto');
      }
    }
    // The v1-only forms are v1 only, and the v2-only forms v2 only.
    const v2card = sign(tagged(card, (old) => old.map((tag) => (tag[0] === 'proto' ? ['proto', '2'] : tag))));
    const v1shares = sign(sharesTemplate({ rootId: ROOT, shares: [share(1)] }, T0));
    expect(
      code(() =>
        parseShares(
          sign(
            tagged(sharesTemplate({ rootId: ROOT, shares: [share(1)] }, T0), (old) =>
              old.map((tag) => (tag[0] === 'proto' ? ['proto', '2'] : tag)),
            ),
          ),
        ),
      ),
    ).toBe('bad-proto');
    expect(code(() => parseSharesV2(v1shares))).toBe('bad-proto');
    expect(code(() => parseSharesV2(v2card))).toBe('accepted');
    expect(code(() => parseAttest(sign(stats, NPUB_SK)))).toBe('bad-proto');
    expect(
      code(() =>
        parseAttestV2(
          sign(attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: OUTCOME }, T0), NPUB_SK),
        ),
      ),
    ).toBe('bad-proto');
    expect(
      code(() =>
        parseDeviceNote(
          sign(tagged(note, (old) => old.map((tag) => (tag[0] === 'proto' ? ['proto', '1'] : tag)))),
        ),
      ),
    ).toBe('bad-proto');
    // v1's message for the default proto is unchanged.
    expect(() =>
      parseTimeout(sign(timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 1 }, T0, '2'))),
    ).toThrow('expected exactly one ["proto","1"] tag');
  });

  it('lobby parsers accept proto "1" and "2" and report it; a root takes its table\'s proto by default', () => {
    const tableT = (proto?: '1' | '2') =>
      tableTemplate(
        {
          tableId: 't1',
          game: 'chess',
          version: '0.1.0',
          seats: 2,
          deadline: 259200,
          invited: [],
          open: 1,
          relays: ['wss://relay.example.com'],
          status: 'open',
          rules: {},
          proto,
        },
        T0,
      );
    expect(parseTable(sign(tableT(), NPUB_SK)).proto).toBe('1');
    const t2 = parseTable(sign(tableT('2'), NPUB_SK));
    expect(t2.proto).toBe('2');
    const root = rootTemplate({ table: t2, joins: [], rules: {}, relays: ['wss://relay.example.com'] }, T0);
    expect(protoTags(root)).toEqual([['proto', '2']]);
    expect(code(() => parseRoot(sign(root, NPUB_SK)))).toBe('bad-tag'); // no seats: shape only
    expect(
      code(() =>
        parseTable(
          sign(
            tagged(tableT('2'), (t) => t.map((tag) => (tag[0] === 'proto' ? ['proto', '3'] : tag))),
            NPUB_SK,
          ),
        ),
      ),
    ).toBe('bad-proto');
  });
});

describe('Shares, protocol 2 (PROTOCOL-v2 §4.2)', () => {
  it('parses the card and roll variants with their anchors', () => {
    const c = parseSharesV2(sign(card));
    expect(c).toMatchObject({ type: 'shares', rootId: ROOT, anchorId: HEAD });
    expect(c.shares.map((s) => s.pos)).toEqual([1, 4]);
    expect(c.shares.map(encodeShare)).toEqual(CARD_SHARES.map(encodeShare));
    const r = parseSharesV2(sign(roll));
    expect(r).toMatchObject({ type: 'roll', rootId: ROOT, anchorId: HEAD, moveId: MOVE });
    expect(r.shares.map((s) => s.pos)).toEqual([0, 2]);
    expect(card.kind).toBe(KIND.shares);
  });

  it('V2-06 rejects a v2 Shares event without exactly one root and one anchor e tag', () => {
    const anchor = ['e', HEAD, '', 'anchor'];
    const cases: [string, EventTemplate][] = [
      ['no anchor', tagged(card, (t) => t.filter((tag) => tag[3] !== 'anchor'))],
      ['no root', tagged(card, (t) => t.filter((tag) => tag[3] !== 'root'))],
      ['two anchors', tagged(card, (t) => [...t, anchor])],
      ['two anchors, no root', tagged(card, (t) => [anchor, anchor, ...t.filter((tag) => tag[0] !== 'e')])],
      ['a third e tag', tagged(card, (t) => [...t, ['e', MOVE, '', 'prev']])],
      ['an unmarked e tag', tagged(card, (t) => [...t, ['e', MOVE]])],
      [
        'a non-hex anchor',
        tagged(card, (t) => t.map((tag) => (tag[3] === 'anchor' ? ['e', 'zz', '', 'anchor'] : tag))),
      ],
    ];
    for (const [name, t] of cases) {
      expect(
        code(() => parseSharesV2(sign(t))),
        name,
      ).toBe('bad-tag');
      expect(
        code(() => parseSharesV2(sign({ ...t, content: roll.content }))),
        `${name} (roll)`,
      ).toBe('bad-tag');
    }
    expect(code(() => parseSharesV2(sign(card)))).toBe('accepted');
  });

  it('V2-07 rejects an empty list, non-ascending pos, another type, or a key set that does not match the type', () => {
    const cases: [string, unknown][] = [
      ['empty card list', { shares: [], type: 'shares' }],
      ['empty roll list', { move: MOVE, shares: [], type: 'roll' }],
      ['descending pos', { shares: [wire(4), wire(1)], type: 'shares' }],
      ['repeated pos', { shares: [wire(2), wire(2)], type: 'shares' }],
      ['descending roll index', { move: MOVE, shares: [wire(1), wire(0)], type: 'roll' }],
      ['type deal', { shares: [wire(1)], type: 'deal' }],
      ['no type', { shares: [wire(1)] }],
      ['card with a move', { move: MOVE, shares: [wire(1)], type: 'shares' }],
      ['roll without a move', { shares: [wire(1)], type: 'roll' }],
      ['an extra key', { anchor: HEAD, shares: [wire(1)], type: 'shares' }],
      ['a non-hex move', { move: 'ab', shares: [wire(1)], type: 'roll' }],
      ['an uppercase move', { move: MOVE.toUpperCase(), shares: [wire(1)], type: 'roll' }],
      ['a share failing the codec', { shares: [{ ...wire(1), extra: 1 }], type: 'shares' }],
      ['not an object', [wire(1)]],
    ];
    for (const [name, c] of cases)
      expect(
        code(() => parseSharesV2(sign(withContent(card, c)))),
        name,
      ).toBe('bad-content');
  });
});

describe('Result attestations, protocol 2 (PROTOCOL-v2 §4.3)', () => {
  it('parses an end attestation of each kind', () => {
    for (const [kind, forfeit] of [
      ['over', []],
      ['claim', [2]],
      ['claim', [0, 1]],
      ['resign', [1]],
    ] as const) {
      const a = parseAttestV2(sign(endOf(kind, [...forfeit])));
      expect(a).toEqual({
        id: expect.any(String),
        pubkey: getPublicKey(SESSION_SK),
        createdAt: T0,
        variant: 'end',
        rootId: ROOT,
        headId: HEAD,
        end: { kind, forfeit, logHash: LOG },
      });
    }
  });

  it('V2-11 parses an end attestation signed by the session key or by the npub: the parser is signer-agnostic', () => {
    expect(parseAttestV2(sign(over, SESSION_SK)).pubkey).toBe(getPublicKey(SESSION_SK));
    expect(parseAttestV2(sign(over, NPUB_SK))).toMatchObject({
      variant: 'end',
      pubkey: getPublicKey(NPUB_SK),
    });
  });

  it('V2-09 rejects an end attestation without a head tag, with keys other than end, an unsorted forfeit, or a forfeit that does not match its kind', () => {
    expect(code(() => parseAttestV2(sign(tagged(over, (t) => t.filter((tag) => tag[3] !== 'head')))))).toBe(
      'bad-tag',
    );
    const e = (end: Record<string, unknown>) => ({ end });
    const cases: [string, unknown][] = [
      ['end plus audit', { audit: 'pass', end: { forfeit: [], kind: 'over', logHash: LOG } }],
      ['end plus outcome', { end: { forfeit: [], kind: 'over', logHash: LOG }, outcome: OUTCOME }],
      ['an extra key in end', e({ forfeit: [], kind: 'over', logHash: LOG, seat: 1 })],
      ['a missing key in end', e({ forfeit: [], kind: 'over' })],
      ['unsorted forfeit', e({ forfeit: [2, 1], kind: 'claim', logHash: LOG })],
      ['repeated forfeit', e({ forfeit: [1, 1], kind: 'claim', logHash: LOG })],
      ['over with a seat', e({ forfeit: [0], kind: 'over', logHash: LOG })],
      ['resign with none', e({ forfeit: [], kind: 'resign', logHash: LOG })],
      ['resign with two', e({ forfeit: [0, 1], kind: 'resign', logHash: LOG })],
      ['claim with none', e({ forfeit: [], kind: 'claim', logHash: LOG })],
      ['another kind', e({ forfeit: [1], kind: 'stop', logHash: LOG })],
      ['a fractional seat', e({ forfeit: [1.5], kind: 'claim', logHash: LOG })],
      ['a bad log hash', e({ forfeit: [], kind: 'over', logHash: LOG.toUpperCase() })],
    ];
    for (const [name, c] of cases)
      expect(
        code(() => parseAttestV2(sign(withContent(over, c)))),
        name,
      ).toBe('bad-content');
  });

  it('parses a stats attestation, with endedBy resign', () => {
    expect(parseAttestV2(sign(stats, NPUB_SK))).toMatchObject({
      variant: 'stats',
      audit: 'pass',
      logHash: LOG,
      outcome: OUTCOME,
    });
    const resigned = { ...OUTCOME, unrated: true as const, endedBy: { type: 'resign' as const, seat: 1 } };
    const t = attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: resigned }, T0, '2');
    expect(parseAttestV2(sign(t, NPUB_SK))).toMatchObject({ variant: 'stats', outcome: resigned });
  });

  it('V2-10 rejects a stats attestation with a head tag, and one whose endedBy.type is "fork"', () => {
    const headed = tagged(stats, (t) => [...t, ['e', HEAD, '', 'head']]);
    expect(code(() => parseAttestV2(sign(headed, NPUB_SK)))).toBe('bad-tag');
    const forked = { ...OUTCOME, unrated: true as const, endedBy: { type: 'fork' as const, seat: 1 } };
    // v1 still accepts its frozen ends.
    const v1 = attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: forked }, T0);
    expect(code(() => parseAttest(sign(v1, NPUB_SK)))).toBe('accepted');
    // The same content at proto 2 (built by hand: the template refuses it) is rejected.
    const t = tagged(v1, (tags) => tags.map((x) => (x[0] === 'proto' ? ['proto', '2'] : x)));
    expect(code(() => parseAttestV2(sign(t, NPUB_SK)))).toBe('bad-content');
  });

  it('attestTemplate refuses to build a proto 2 stats attestation ended by a fork (T2/T3 review I1)', () => {
    const forked = { ...OUTCOME, unrated: true as const, endedBy: { type: 'fork' as const, seat: 1 } };
    const build = () =>
      attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: forked }, T0, '2');
    expect(build).toThrow(ProtocolError);
    expect(code(build)).toBe('bad-content');
    // v1 keeps building it, byte for byte as before.
    expect(attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: forked }, T0).tags).toEqual([
      ['e', ROOT, '', 'root'],
      ['proto', '1'],
    ]);
  });

  it('parseAttestV2 dispatches on the exact key list: comma-bearing keys match neither variant (review I4)', () => {
    for (const c of [
      { 'audit,logHash': 'pass', outcome: OUTCOME },
      { audit: 'pass', 'logHash,outcome': LOG },
      { 'end,x': {} },
    ]) {
      expect(
        code(() => parseAttestV2(sign(withContent(stats, c), NPUB_SK))),
        JSON.stringify(c),
      ).toBe('bad-content');
    }
  });

  it('V2-51 rejects an end attestation without exactly the root and head e tags, and a stats attestation or Device note without exactly the root one', () => {
    const root = ['e', ROOT, '', 'root'];
    const head = ['e', HEAD, '', 'head'];
    const endCases: string[][][] = [
      [root],
      [head],
      [root, head, ['e', MOVE, '', 'prev']],
      [root, head, head],
      [root, root],
      [root, ['e', HEAD, '', 'anchor']],
      [root, ['e', HEAD]],
    ];
    for (const tags of endCases) {
      const t = tagged(over, (old) => [...tags, ...old.filter((tag) => tag[0] !== 'e')]);
      expect(
        code(() => parseAttestV2(sign(t))),
        JSON.stringify(tags),
      ).toBe('bad-tag');
    }
    for (const tags of [[], [root, root], [root, head], [head], [root, ['e', MOVE, '', 'anchor']]]) {
      const s = tagged(stats, (old) => [...tags, ...old.filter((tag) => tag[0] !== 'e')]);
      expect(
        code(() => parseAttestV2(sign(s, NPUB_SK))),
        `stats ${JSON.stringify(tags)}`,
      ).toBe('bad-tag');
      const n = tagged(note, (old) => [...tags, ...old.filter((tag) => tag[0] !== 'e')]);
      expect(
        code(() => parseDeviceNote(sign(n))),
        `note ${JSON.stringify(tags)}`,
      ).toBe('bad-tag');
    }
  });

  it('rejects content that is neither variant', () => {
    for (const c of [{}, { audit: 'pass', logHash: LOG }, { end: null, logHash: LOG }, 'end', null]) {
      expect(
        code(() => parseAttestV2(sign(withContent(over, c)))),
        JSON.stringify(c),
      ).toBe('bad-content');
    }
  });
});

describe('Device note (PROTOCOL-v2 §4.4)', () => {
  it('parses a note', () => {
    expect(parseDeviceNote(sign(note))).toMatchObject({ rootId: ROOT, device: DEVICE, n: 1 });
    expect(note.kind).toBe(7458);
    const big = deviceNoteTemplate({ rootId: ROOT, device: DEVICE, n: 9007199254740991 }, T0);
    expect(parseDeviceNote(sign(big)).n).toBe(9007199254740991);
  });

  it('V2-13 rejects a device that is not 32 lowercase hex characters, and an n that is not an integer of at least 1 without leading zeros', () => {
    const bad = (device: unknown, n: unknown) => sign(withContent(note, { device, n, type: 'device' }));
    for (const device of [
      DEVICE.slice(1),
      `${DEVICE}0`,
      DEVICE.toUpperCase(),
      `${DEVICE.slice(0, 31)}g`,
      '',
      7,
    ])
      expect(
        code(() => parseDeviceNote(bad(device, 1))),
        `device ${String(device)}`,
      ).toBe('bad-content');
    for (const n of [0, -1, 1.5, '1', null, 9007199254740992])
      expect(
        code(() => parseDeviceNote(bad(DEVICE, n))),
        `n ${String(n)}`,
      ).toBe('bad-content');
    for (const n of ['01', '1.0', '1e0', '+1'])
      expect(
        code(() =>
          parseDeviceNote(sign({ ...note, content: `{"device":"${DEVICE}","n":${n},"type":"device"}` })),
        ),
        `n ${n}`,
      ).toBe('bad-content');
    expect(
      code(() => parseDeviceNote(sign(withContent(note, { device: DEVICE, n: 1, type: 'devices' })))),
    ).toBe('bad-content');
    expect(code(() => parseDeviceNote(sign(withContent(note, { device: DEVICE, n: 1 }))))).toBe(
      'bad-content',
    );
  });
});
