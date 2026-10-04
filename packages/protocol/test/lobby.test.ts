import { createHash } from 'node:crypto';
import { chainReaction } from '@bored-games/chain-reaction';
import { G, type Point, q } from '@bored-games/deck';
import { canonicalJson, createRng, type GameModule } from '@bored-games/game-kit';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { ProtocolError } from '../src/errors.ts';
import { KIND, MAX_EVENT_BYTES, type Proto } from '../src/kinds.ts';
import {
  joinTemplate,
  makeJoinPok,
  type ParsedJoin,
  type ParsedRoot,
  type ParsedTable,
  parseJoin,
  parseRoot,
  parseTable,
  rootTemplate,
  rulesHash,
  sessionMessage,
  signSession,
  type TableSpec,
  tableAddress,
  tableTemplate,
  validateRoot,
  validateTable,
  verifyJoin,
} from '../src/lobby.ts';
import { type EventTemplate, finalizeEvent, getPublicKey, type Hex, type NostrEvent } from '../src/nostr.ts';
import { many, one, requireProto } from '../src/tags.ts';

function seededRandom(seed: string) {
  const rng = createRng(seed);
  return (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

const rnd = seededRandom('protocol-lobby');

/** 32 big-endian bytes of a scalar: the secret key whose x-only public key is the x-coordinate of `x·G`. */
function scalarBytes(x: bigint): Uint8Array {
  return Uint8Array.from(Buffer.from(x.toString(16).padStart(64, '0'), 'hex'));
}

function secretKey(label: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(label, 'utf8').digest());
}

interface Player {
  sk: Uint8Array;
  npub: Hex;
  sessionSk: Uint8Array;
  session: Hex;
  x: bigint;
  X: Point;
}

function player(name: string, x?: bigint): Player {
  const sk = secretKey(`npub:${name}`);
  const deck =
    x ?? (BigInt(`0x${createHash('sha256').update(`deck:${name}`).digest('hex')}`) % (q - 1n)) + 1n;
  const sessionSk = secretKey(`session:${name}`);
  return {
    sk,
    npub: getPublicKey(sk),
    sessionSk,
    session: getPublicKey(sessionSk),
    x: deck,
    X: G.multiply(deck),
  };
}

const A = player('creator');
const B = player('invited');
const C = player('open');
const D = player('stranger');
const E = player('another');

const RELAYS = ['wss://relay.example.com', 'ws://localhost:7777'];
const T0 = 1_790_000_000;

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
const modules: ReadonlyMap<string, GameModule<any, any, any>> = new Map([[chainReaction.id, chainReaction]]);
const RULES = chainReaction.defaultRules();

const tableSpec: TableSpec = {
  tableId: 'friday-game.1',
  game: chainReaction.id,
  version: chainReaction.version,
  seats: 3,
  deadline: 259200,
  invited: [B.npub],
  open: 1,
  relays: RELAYS,
  status: 'open',
  rules: RULES,
};

function sign(t: EventTemplate, sk: Uint8Array): NostrEvent {
  return finalizeEvent(t, sk, rnd);
}

function tableEvent(spec: Partial<TableSpec> = {}, sk = A.sk): NostrEvent {
  return sign(tableTemplate({ ...tableSpec, ...spec }, T0), sk);
}

const tableEv = tableEvent();
const table = parseTable(tableEv);
const ADDRESS = tableAddress(A.npub, tableSpec.tableId);

interface JoinOpts {
  address?: string;
  creator?: Hex;
  /** The session secret key, when it is not the player's own; the Join's `session` is its public key. */
  sessionSk?: Uint8Array;
  /** The `sessionSig` to publish instead of the session key's own signature. */
  sessionSig?: Hex;
  /** The session the proof binds, when it should differ from the published one. */
  pokSession?: Hex;
  relays?: string[];
  /** The table the Join commits to, when it is not the default one. */
  table?: ParsedTable;
  rulesHash?: Hex;
  version?: string;
  /** The Join's proto; the table's (or `'1'`) when absent. */
  proto?: Proto;
}

function joinEvent(p: Player, o: JoinOpts = {}): NostrEvent {
  const address = o.address ?? ADDRESS;
  const sessionSk = o.sessionSk ?? p.sessionSk;
  const session = getPublicKey(sessionSk);
  const pok = makeJoinPok(p.x, address, p.npub, o.pokSession ?? session, rnd);
  const spec = {
    tableAddress: address,
    creator: o.creator ?? A.npub,
    deckKey: p.X,
    pok,
    relays: o.relays ?? [RELAYS[0] as string],
    session,
    sessionSig: o.sessionSig ?? signSession(sessionSk, address, p.npub, rnd),
    rulesHash: o.rulesHash ?? rulesHash(o.table?.rules ?? RULES),
    version: o.version ?? o.table?.version ?? tableSpec.version,
    proto: o.proto ?? o.table?.proto,
  };
  return sign(joinTemplate(spec, T0 + 10), p.sk);
}

function join(p: Player, o: JoinOpts = {}): ParsedJoin {
  return parseJoin(joinEvent(p, o));
}

const jA = join(A);
const jB = join(B);
const jC = join(C);

function rootEvent(
  joins: ParsedJoin[],
  t: ParsedTable = table,
  rules: unknown = RULES,
  sk = A.sk,
): NostrEvent {
  return sign(rootTemplate({ table: t, joins, rules, relays: RELAYS }, T0 + 100), sk);
}

function byId(...joins: ParsedJoin[]): Map<Hex, ParsedJoin> {
  return new Map(joins.map((j) => [j.id, j]));
}

const rootEv = rootEvent([jA, jB, jC]);
const root = parseRoot(rootEv);

/** `ev`'s fields patched by `edit` (which reads a copy of them), re-signed by `sk`. */
function resign(
  ev: NostrEvent,
  edit: (t: EventTemplate) => Partial<EventTemplate>,
  sk: Uint8Array,
): NostrEvent {
  const t: EventTemplate = {
    kind: ev.kind,
    created_at: ev.created_at,
    tags: ev.tags.map((tag) => [...tag]),
    content: ev.content,
  };
  return sign({ ...t, ...edit(t) }, sk);
}

/** The same JSON value with every object's keys in reverse order. */
function reverseKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reverseKeys);
  if (typeof v !== 'object' || v === null) return v;
  return Object.fromEntries(
    Object.entries(v)
      .reverse()
      .map(([k, x]) => [k, reverseKeys(x)]),
  );
}

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof ProtocolError) return e.code;
    return `not a ProtocolError: ${String(e)}`;
  }
  return 'accepted';
}

/* ---------------------------------------------------------------------------------------- tag helpers */

describe('tag helpers', () => {
  const tags = [
    ['proto', '1'],
    ['d', 'x'],
    ['relay', 'wss://a'],
    ['relay', 'wss://b'],
    ['dup', '1'],
    ['dup', '2'],
    ['long', 'a', 'b'],
  ];

  it('one returns the single value and rejects a missing, duplicated or wrong-length tag', () => {
    expect(one(tags, 'd')).toBe('x');
    expect(codeOf(() => one(tags, 'nope'))).toBe('bad-tag');
    expect(codeOf(() => one(tags, 'dup'))).toBe('bad-tag');
    expect(codeOf(() => one(tags, 'long'))).toBe('bad-tag');
  });

  it('many returns every value in order and rejects a wrong-length tag', () => {
    expect(many(tags, 'relay')).toEqual(['wss://a', 'wss://b']);
    expect(many(tags, 'nope')).toEqual([]);
    expect(codeOf(() => many(tags, 'long'))).toBe('bad-tag');
  });

  it('requireProto accepts exactly one proto tag, "1" or "2" (or the expected one), and returns it', () => {
    expect(requireProto(tags)).toBe('1');
    expect(requireProto([['proto', '2']])).toBe('2');
    expect(requireProto(tags, '1')).toBe('1');
    expect(codeOf(() => requireProto([]))).toBe('bad-proto');
    expect(codeOf(() => requireProto([['proto', '3']]))).toBe('bad-proto');
    expect(codeOf(() => requireProto([['proto', '2']], '1'))).toBe('bad-proto');
    expect(codeOf(() => requireProto(tags, '2'))).toBe('bad-proto');
    // A caller's bad expected value never admits it.
    expect(codeOf(() => requireProto([['proto', '3']], '3' as never))).toBe('bad-proto');
    // The expected form keeps v1's message.
    expect(() => requireProto([['proto', '2']], '1')).toThrow('expected exactly one ["proto","1"] tag');
    expect(
      codeOf(() =>
        requireProto([
          ['proto', '1'],
          ['proto', '1'],
        ]),
      ),
    ).toBe('bad-proto');
    expect(codeOf(() => requireProto([['proto', '1', 'x']]))).toBe('bad-proto');
  });
});

/* ---------------------------------------------------------------------------------------- round trips */

describe('round trips', () => {
  it('table: the template parses back to its spec, with the creator and address', () => {
    expect(tableEv.kind).toBe(KIND.table);
    expect(table).toEqual({ ...tableSpec, creator: A.npub, address: ADDRESS, proto: '1' });
    expect(ADDRESS).toBe(`37450:${A.npub}:friday-game.1`);
    expect(tableEv.content).toBe(canonicalJson({ rules: RULES }));
    expect(tableEv.tags).toContainEqual(['proto', '1']);
  });

  it('table: a table with no invitations and only open seats parses', () => {
    const t = parseTable(tableEvent({ invited: [], open: 2, status: 'started', deadline: 86400 }));
    expect(t.invited).toEqual([]);
    expect(t.open).toBe(2);
    expect(t.status).toBe('started');
    expect(t.deadline).toBe(86400);
  });

  it('join: the template parses back to its spec, with the id and npub', () => {
    const ev = joinEvent(B);
    expect(ev.kind).toBe(KIND.join);
    const j = parseJoin(ev);
    expect(j.id).toBe(ev.id);
    expect(j.npub).toBe(B.npub);
    expect(j.tableAddress).toBe(ADDRESS);
    expect(j.creator).toBe(A.npub);
    expect(j.deckKey.equals(B.X)).toBe(true);
    expect(j.session).toBe(B.session);
    expect(j.relays).toEqual([RELAYS[0]]);
    expect(j.rulesHash).toBe(rulesHash(RULES));
    expect(j.version).toBe(tableSpec.version);
    expect(ev.tags).toContainEqual(['rules-hash', rulesHash(RULES)]);
    expect(ev.tags).toContainEqual(['v', tableSpec.version]);
    expect(verifyJoin(j)).toBe(true);
    expect(ev.tags).toContainEqual(['a', ADDRESS]);
    expect(ev.tags).toContainEqual(['p', A.npub]);
  });

  it('makeJoinPok binds the table address, npub and session', () => {
    expect(verifyJoin(join(B, { pokSession: C.session }))).toBe(false);
    expect(verifyJoin({ ...jB, npub: C.npub })).toBe(false);
    expect(verifyJoin({ ...jB, tableAddress: tableAddress(A.npub, 'other') })).toBe(false);
    expect(verifyJoin({ ...jB, deckKey: C.X })).toBe(false);
  });

  it('root: the template parses back, with tags as PROTOCOL §4.3', () => {
    expect(rootEv.kind).toBe(KIND.root);
    expect(root.id).toBe(rootEv.id);
    expect(root.creator).toBe(A.npub);
    expect(root.tableAddress).toBe(ADDRESS);
    expect(root.game).toBe(chainReaction.id);
    expect(root.version).toBe(chainReaction.version);
    expect(root.deadline).toBe(259200);
    expect(root.rulesHash).toBe(rulesHash(RULES));
    expect(root.joinIds).toEqual([jA.id, jB.id, jC.id]);
    expect(root.relays).toEqual(RELAYS);
    expect(root.rules).toEqual(RULES);
    expect(root.seats.map((s) => [s.npub, s.session])).toEqual([
      [A.npub, A.session],
      [B.npub, B.session],
      [C.npub, C.session],
    ]);
    expect(root.seats.every((s, i) => s.deckKey.equals([A, B, C][i]?.X as Point))).toBe(true);
    expect(rootEv.tags).toContainEqual(['e', jB.id, RELAYS[0], 'seat:1']);
    expect(rootEv.tags).toContainEqual(['rules-hash', rulesHash(RULES)]);
    expect(rootEv.tags).toContainEqual(['a', ADDRESS]);
  });

  it('rulesHash is the hex SHA-256 of the UTF-8 of the canonical rules', () => {
    const expected = createHash('sha256').update(canonicalJson(RULES), 'utf8').digest('hex');
    expect(rulesHash(RULES)).toBe(expected);
    expect(rulesHash({ b: 1, a: 'é' })).toBe(
      createHash('sha256').update('{"a":"é","b":1}', 'utf8').digest('hex'),
    );
  });
});

/* -------------------------------------------------------------------------- hostile shapes (Focus 1) */

interface ParserCase {
  name: string;
  parse: (ev: unknown) => unknown;
  ev: NostrEvent;
  sk: Uint8Array;
  /** Tags that must appear exactly once. */
  once: string[];
  /** Multi-valued tags that must appear at least once. */
  atLeastOnce: string[];
}

const parsers: ParserCase[] = [
  {
    name: 'parseTable',
    parse: parseTable,
    ev: tableEv,
    sk: A.sk,
    once: ['d', 'game', 'v', 'seats', 'deadline', 'open', 'status'],
    atLeastOnce: ['relay'],
  },
  {
    name: 'parseJoin',
    parse: parseJoin,
    ev: joinEvent(B),
    sk: B.sk,
    once: ['a', 'p', 'rules-hash', 'v'],
    atLeastOnce: [],
  },
  {
    name: 'parseRoot',
    parse: parseRoot,
    ev: rootEv,
    sk: A.sk,
    once: ['a', 'game', 'v', 'deadline', 'rules-hash'],
    atLeastOnce: ['e', 'relay'],
  },
];

for (const c of parsers) {
  describe(`${c.name}: hostile shapes`, () => {
    const re = (edit: (t: EventTemplate) => Partial<EventTemplate>) => resign(c.ev, edit, c.sk);

    it('accepts the honest event', () => {
      expect(codeOf(() => c.parse(c.ev))).toBe('accepted');
    });

    it('rejects a wrong kind', () => {
      expect(codeOf(() => c.parse(re((t) => ({ kind: t.kind + 1 }))))).toBe('wrong-kind');
    });

    it('rejects a missing, duplicated or wrong proto tag', () => {
      expect(codeOf(() => c.parse(re((t) => ({ tags: t.tags.filter((x) => x[0] !== 'proto') }))))).toBe(
        'bad-proto',
      );
      expect(codeOf(() => c.parse(re((t) => ({ tags: [...t.tags, ['proto', '1']] }))))).toBe('bad-proto');
      expect(
        codeOf(() =>
          c.parse(re((t) => ({ tags: t.tags.map((x) => (x[0] === 'proto' ? ['proto', '3'] : x)) }))),
        ),
      ).toBe('bad-proto');
    });

    it('accepts proto "2" too, and reports the proto (PROTOCOL-v2 §2 item 3)', () => {
      expect(c.parse(c.ev)).toMatchObject({ proto: '1' });
      const v2 = re((t) => ({ tags: t.tags.map((x) => (x[0] === 'proto' ? ['proto', '2'] : x)) }));
      expect(c.parse(v2)).toMatchObject({ proto: '2' });
    });

    for (const name of [...c.once, ...c.atLeastOnce]) {
      it(`rejects a missing "${name}" tag`, () => {
        expect(codeOf(() => c.parse(re((t) => ({ tags: t.tags.filter((x) => x[0] !== name) }))))).toBe(
          'bad-tag',
        );
      });
    }

    for (const name of c.once) {
      it(`rejects a duplicated "${name}" tag`, () => {
        const dup = (t: EventTemplate) => ({
          tags: [...t.tags, [...(t.tags.find((x) => x[0] === name) as string[])]],
        });
        expect(codeOf(() => c.parse(re(dup)))).toBe('bad-tag');
      });

      it(`rejects a "${name}" tag with an extra item`, () => {
        const extra = (t: EventTemplate) => ({
          tags: t.tags.map((x) => (x[0] === name ? [...x, 'extra'] : x)),
        });
        expect(codeOf(() => c.parse(re(extra)))).toBe('bad-tag');
      });
    }

    it('rejects non-canonical content: whitespace, unsorted keys, invalid JSON, a huge number', () => {
      const parsed = JSON.parse(c.ev.content) as Record<string, unknown>;
      expect(codeOf(() => c.parse(re((t) => ({ content: ` ${t.content}` }))))).toBe('bad-content');
      expect(codeOf(() => c.parse(re(() => ({ content: JSON.stringify(parsed, null, 1) }))))).toBe(
        'bad-content',
      );
      const unsorted = JSON.stringify(reverseKeys(parsed));
      expect(unsorted).not.toBe(c.ev.content);
      expect(codeOf(() => c.parse(re(() => ({ content: unsorted }))))).toBe('bad-content');
      expect(codeOf(() => c.parse(re(() => ({ content: 'not json' }))))).toBe('bad-content');
      expect(codeOf(() => c.parse(re(() => ({ content: '' }))))).toBe('bad-content');
      expect(codeOf(() => c.parse(re(() => ({ content: '1e999' }))))).toBe('bad-content');
    });

    it('rejects canonical content with an extra or a missing key, or of the wrong type', () => {
      const parsed = JSON.parse(c.ev.content) as Record<string, unknown>;
      expect(codeOf(() => c.parse(re(() => ({ content: canonicalJson({ ...parsed, zz: 1 }) }))))).toBe(
        'bad-content',
      );
      const [first] = Object.keys(parsed);
      const { [first as string]: _gone, ...rest } = parsed;
      expect(codeOf(() => c.parse(re(() => ({ content: canonicalJson(rest) }))))).toBe('bad-content');
      for (const v of ['[]', 'null', '7', '"x"'])
        expect(codeOf(() => c.parse(re(() => ({ content: v }))))).toBe('bad-content');
      expect(codeOf(() => c.parse(re((t) => ({ content: `{"__proto__":{},${t.content.slice(1)}` }))))).toBe(
        'bad-content',
      );
    });

    it('rejects an oversized event', () => {
      const big = re((t) => ({ tags: [...t.tags, ['pad', 'x'.repeat(MAX_EVENT_BYTES)]] }));
      expect(codeOf(() => c.parse(big))).toBe('too-large');
    });

    it('rejects non-string tag items, and an id or sig of the wrong length', () => {
      expect(codeOf(() => c.parse(re((t) => ({ tags: [...t.tags, ['x', 5 as unknown as string]] }))))).toBe(
        'invalid-event',
      );
      expect(codeOf(() => c.parse({ ...c.ev, id: c.ev.id.slice(2) }))).toBe('invalid-event');
      expect(codeOf(() => c.parse({ ...c.ev, sig: c.ev.sig.slice(2) }))).toBe('invalid-event');
      expect(codeOf(() => c.parse({ ...c.ev, sig: `${c.ev.sig}00` }))).toBe('invalid-event');
    });

    it('rejects a forged event: altered content or a foreign signature', () => {
      expect(codeOf(() => c.parse({ ...c.ev, content: `${c.ev.content} ` }))).toBe('invalid-event');
      expect(codeOf(() => c.parse({ ...c.ev, pubkey: E.npub }))).toBe('invalid-event');
    });

    it('ignores unknown tags', () => {
      expect(codeOf(() => c.parse(re((t) => ({ tags: [...t.tags, ['client', 'x', 'y']] }))))).toBe(
        'accepted',
      );
    });

    it('throws only ProtocolError on garbage input', () => {
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            throw new Error('boom');
          },
          get() {
            throw new Error('boom');
          },
        },
      );
      const cyclic: Record<string, unknown> = { ...c.ev };
      cyclic.self = cyclic;
      const garbage = [null, undefined, 7, 'ev', [], {}, hostile, cyclic, { ...c.ev, extra: 1n }, () => c.ev];
      // Labeled by index: String(hostile) itself would throw.
      garbage.forEach((bad, i) => {
        expect(
          codeOf(() => c.parse(bad)),
          `garbage[${i}]`,
        ).toBe('invalid-event');
      });
    });
  });
}

/* ---------------------------------------------------------------------------------- table specifics */

describe('parseTable: field rules', () => {
  const tagEdit = (name: string, value: string) => (t: EventTemplate) => ({
    tags: t.tags.map((x) => (x[0] === name ? [name, value] : x)),
  });
  const bad = (edit: (t: EventTemplate) => Partial<EventTemplate>) =>
    codeOf(() => parseTable(resign(tableEv, edit, A.sk)));

  it('tableId is 1–64 characters of [A-Za-z0-9._-]', () => {
    for (const d of ['', 'a b', 'a/b', 'é', 'a:b', 'x'.repeat(65)])
      expect(bad(tagEdit('d', d)), d).toBe('bad-tag');
    expect(bad(tagEdit('d', 'x'.repeat(64)))).toBe('accepted');
    expect(bad(tagEdit('d', 'A-z_0.9'))).toBe('accepted');
  });

  it('game and version are non-empty and at most 64 characters', () => {
    for (const name of ['game', 'v']) {
      expect(bad(tagEdit(name, '')), name).toBe('bad-tag');
      expect(bad(tagEdit(name, 'x'.repeat(65))), name).toBe('bad-tag');
      expect(bad(tagEdit(name, 'x'.repeat(64))), name).toBe('accepted');
    }
  });

  it('seats, open and deadline are decimal without leading zeros', () => {
    for (const v of ['03', '+3', '3.0', ' 3', '3 ', '0x3', '-3', '', '1e1', '99999999999999999999'])
      expect(bad(tagEdit('seats', v)), `seats ${v}`).toBe('bad-tag');
    for (const v of ['01', '-1', '1.0', '']) expect(bad(tagEdit('open', v)), `open ${v}`).toBe('bad-tag');
    for (const v of ['0259200', '259200.0', ' 259200'])
      expect(bad(tagEdit('deadline', v)), `deadline ${v}`).toBe('bad-tag');
  });

  it('the deadline is one of DEADLINES', () => {
    expect(bad(tagEdit('deadline', '3600'))).toBe('bad-tag');
    expect(bad(tagEdit('deadline', '604800'))).toBe('accepted');
  });

  it('seats ≥ 2 and invited + open = seats − 1', () => {
    expect(codeOf(() => parseTable(tableEvent({ seats: 1, invited: [], open: 0 })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ seats: 2, invited: [], open: 1 })))).toBe('accepted');
    expect(codeOf(() => parseTable(tableEvent({ seats: 3, invited: [B.npub], open: 0 })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ seats: 3, invited: [B.npub], open: 2 })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ seats: 0, invited: [], open: 0 })))).toBe('bad-tag');
  });

  it('status is open, started or cancelled', () => {
    expect(bad(tagEdit('status', 'closed'))).toBe('bad-tag');
    expect(bad(tagEdit('status', 'cancelled'))).toBe('accepted');
  });

  it('invited p tags are lowercase hex64, unique, and not the creator', () => {
    expect(codeOf(() => parseTable(tableEvent({ invited: [B.npub.toUpperCase()] })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ invited: [B.npub.slice(1)] })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ seats: 4, invited: [B.npub, B.npub], open: 1 })))).toBe(
      'bad-tag',
    );
    expect(codeOf(() => parseTable(tableEvent({ invited: [A.npub] })))).toBe('bad-tag');
    expect(codeOf(() => parseTable(tableEvent({ seats: 4, invited: [B.npub, C.npub], open: 1 })))).toBe(
      'accepted',
    );
  });

  it('relays follow the strict URL grammar', () => {
    for (const r of [
      'wss://@@',
      'wss://[',
      'wss://-',
      'wss://-relay.example.com',
      'wss://host:abc',
      'wss://host:',
      'wss://a@b@c',
      'wss://user:pw@relay.example.com',
      'wss://x:99999999',
      'wss://x:65536',
      'wss://x:123456',
      'wss://relay.example.com/\u0085',
      'wss://relay.example.com/\u009f',
      'wss://relay.example.com/a b',
      'wss://[zz::1]',
      'wss://[]',
      'wss://[1234]',
      'wss://256.1.1.1',
      'wss://1.2.3',
      'wss://rel_ay.example.com',
      'wss://relay.example.com:80:80',
    ])
      expect(
        codeOf(() => parseTable(tableEvent({ relays: [r] }))),
        JSON.stringify(r),
      ).toBe('bad-tag');
    for (const r of [
      'wss://relay.damus.io',
      'ws://localhost:7777',
      'wss://[::1]:7000/path',
      'wss://10.0.0.1',
      'wss://relay.example.com:65535',
      'wss://relay.example.com?x=1#f',
    ])
      expect(
        codeOf(() => parseTable(tableEvent({ relays: [r] }))),
        r,
      ).toBe('accepted');
  });

  it('duplicate relays are rejected', () => {
    expect(codeOf(() => parseTable(tableEvent({ relays: ['wss://a.example', 'wss://a.example'] })))).toBe(
      'bad-tag',
    );
  });

  it('at most 64 seats', () => {
    const seats = (n: number) => tableEvent({ seats: n, invited: [], open: n - 1 });
    expect(codeOf(() => parseTable(seats(64)))).toBe('accepted');
    expect(codeOf(() => parseTable(seats(65)))).toBe('bad-tag');
  });

  it('relays are ws:// or wss:// URLs with a host, no whitespace, at most 256 characters', () => {
    for (const r of [
      'https://relay.example.com',
      'wss://',
      'wss:///path',
      'ws://:443',
      'wss://user@',
      'WSS://relay.example.com',
      'wss://relay example.com',
      'wss://relay.example.com/\n',
      'wss://relay\u0000.com',
      'relay.example.com',
      '',
      `wss://${'x'.repeat(251)}`,
    ])
      expect(
        codeOf(() => parseTable(tableEvent({ relays: [r] }))),
        JSON.stringify(r),
      ).toBe('bad-tag');
    for (const r of [
      'wss://relay.example.com/',
      'ws://127.0.0.1:7777/path?x=1',
      'wss://[::1]:443',
      `wss://${'x'.repeat(250)}`,
    ])
      expect(
        codeOf(() => parseTable(tableEvent({ relays: [r] }))),
        r,
      ).toBe('accepted');
  });
});

/* ----------------------------------------------------------------------------------- join specifics */

describe('parseJoin: field rules', () => {
  const ev = joinEvent(B);
  const content = JSON.parse(ev.content) as Record<string, unknown>;
  const withContent = (patch: Record<string, unknown>) =>
    codeOf(() => parseJoin(resign(ev, () => ({ content: canonicalJson({ ...content, ...patch }) }), B.sk)));
  const withTag = (name: string, value: string) =>
    codeOf(() =>
      parseJoin(resign(ev, (t) => ({ tags: t.tags.map((x) => (x[0] === name ? [name, value] : x)) }), B.sk)),
    );

  it('the a tag is a table address and the p tag is its creator', () => {
    expect(withTag('a', `30023:${A.npub}:friday-game.1`)).toBe('bad-tag');
    expect(withTag('a', `37450:${A.npub.toUpperCase()}:friday-game.1`)).toBe('bad-tag');
    expect(withTag('a', `37450:${A.npub}:`)).toBe('bad-tag');
    expect(withTag('a', `37450:${A.npub}:bad id`)).toBe('bad-tag');
    expect(withTag('p', C.npub)).toBe('bad-tag');
    expect(withTag('p', A.npub.toUpperCase())).toBe('bad-tag');
  });

  it('deckKey is a canonical point and pok two canonical scalars', () => {
    expect(withContent({ deckKey: 'x' })).toBe('bad-content');
    expect(withContent({ deckKey: 7 })).toBe('bad-content');
    expect(withContent({ deckKey: `${'A'.repeat(43)}A` })).toBe('bad-content');
    expect(withContent({ pok: { c: 'x', s: 'y' } })).toBe('bad-content');
    expect(withContent({ pok: { ...(content.pok as object), z: 1 } })).toBe('bad-content');
    expect(withContent({ pok: null })).toBe('bad-content');
  });

  it('session is lowercase hex64 and relays a non-empty list of relay URLs', () => {
    expect(withContent({ session: B.session.toUpperCase() })).toBe('bad-content');
    expect(withContent({ session: 7 })).toBe('bad-content');
    expect(withContent({ relays: [] })).toBe('bad-content');
    expect(withContent({ relays: ['https://x.example'] })).toBe('bad-content');
    expect(withContent({ relays: 'wss://x.example' })).toBe('bad-content');
    expect(withContent({ relays: [7] })).toBe('bad-content');
    expect(withContent({ relays: RELAYS })).toBe('accepted');
    expect(withContent({ relays: ['wss://a.example', 'wss://a.example'] })).toBe('bad-content');
    expect(withContent({ relays: ['wss://@@'] })).toBe('bad-content');
  });

  it('the rules-hash tag is hex64 and the v tag 1 to 64 characters', () => {
    expect(withTag('rules-hash', rulesHash(RULES).toUpperCase())).toBe('bad-tag');
    expect(withTag('rules-hash', 'abc')).toBe('bad-tag');
    expect(withTag('v', '')).toBe('bad-tag');
    expect(withTag('v', 'x'.repeat(65))).toBe('bad-tag');
  });
});

describe('parseJoin: the session key proof of possession (D033)', () => {
  const ev = joinEvent(B);
  const content = JSON.parse(ev.content) as Record<string, unknown>;
  const reason = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof ProtocolError ? `${e.code}: ${e.message}` : `not a ProtocolError: ${String(e)}`;
    }
    return 'accepted';
  };
  const withContent = (patch: Record<string, unknown>, from = ev, sk = B.sk) =>
    reason(() =>
      parseJoin(
        resign(from, () => ({ content: canonicalJson({ ...JSON.parse(from.content), ...patch }) }), sk),
      ),
    );

  it('a valid Join parses, its sessionSig a BIP-340 signature over the PROTOCOL §4.2 message', () => {
    const j = parseJoin(ev);
    expect(j.sessionSig).toBe(content.sessionSig);
    expect(j.sessionSig).toMatch(/^[0-9a-f]{128}$/);
    const msg = createHash('sha256').update(`bored-games/v1/session\n${ADDRESS}\n${B.npub}`, 'utf8').digest();
    expect(sessionMessage(ADDRESS, B.npub)).toEqual(new Uint8Array(msg));
    expect(schnorr.verify(hexToBytes(j.sessionSig), msg, hexToBytes(B.session))).toBe(true);
  });

  it("rejects a Join that copies another player's session and sessionSig: the signature binds the npub", () => {
    // D's proof of knowledge binds B's session, so only the session signature can stop the copy.
    const copied = joinEvent(D, { pokSession: B.session });
    const outcome = withContent({ session: jB.session, sessionSig: jB.sessionSig }, copied, D.sk);
    expect(outcome).toMatch(/^bad-content: sessionSig/);
  });

  it('rejects a sessionSig made for another table address', () => {
    const other = signSession(B.sessionSk, tableAddress(A.npub, 'another-table'), B.npub, rnd);
    expect(withContent({ sessionSig: other })).toMatch(/^bad-content: sessionSig/);
  });

  it('rejects a tampered signature', () => {
    const sig = content.sessionSig as string;
    const flipped = `${sig.slice(0, 10)}${sig[10] === '0' ? '1' : '0'}${sig.slice(11)}`;
    expect(withContent({ sessionSig: flipped })).toMatch(/^bad-content: sessionSig/);
    expect(withContent({ sessionSig: `${sig.slice(64)}${sig.slice(0, 64)}` })).toMatch(/^bad-content/);
  });

  it('rejects uppercase, short, long, non-string or missing sessionSig', () => {
    const sig = content.sessionSig as string;
    for (const bad of [sig.toUpperCase(), sig.slice(2), `${sig}00`, '', 7, null]) {
      expect(withContent({ sessionSig: bad }), String(bad)).toMatch(/^bad-content: sessionSig/);
    }
    const { sessionSig: _gone, ...rest } = content;
    expect(reason(() => parseJoin(resign(ev, () => ({ content: canonicalJson(rest) }), B.sk)))).toMatch(
      /^bad-content/,
    );
  });

  it('signSession refuses a random source of the wrong length', () => {
    expect(() => signSession(B.sessionSk, ADDRESS, B.npub, () => new Uint8Array(31))).toThrow(RangeError);
  });
});

/* ----------------------------------------------------------------------------------- root specifics */

describe('parseRoot: field rules', () => {
  const content = JSON.parse(rootEv.content) as { rules: unknown; seats: Record<string, unknown>[] };
  const withSeat = (i: number, patch: Record<string, unknown>) => {
    const seats = content.seats.map((s, k) => (k === i ? { ...s, ...patch } : s));
    return codeOf(() =>
      parseRoot(resign(rootEv, () => ({ content: canonicalJson({ ...content, seats }) }), A.sk)),
    );
  };
  const withTags = (f: (tags: string[][]) => string[][]) =>
    codeOf(() => parseRoot(resign(rootEv, (t) => ({ tags: f(t.tags) }), A.sk)));
  const eTags = (tags: string[][]) => tags.filter((x) => x[0] === 'e');
  const others = (tags: string[][]) => tags.filter((x) => x[0] !== 'e');

  it('seats[].npub and seats[].session are lowercase hex64 (D025), deckKey a point, no extra keys', () => {
    expect(withSeat(1, { npub: B.npub.toUpperCase() })).toBe('bad-content');
    expect(withSeat(1, { session: B.session.slice(2) })).toBe('bad-content');
    expect(withSeat(1, { deckKey: 'nope' })).toBe('bad-content');
    expect(withSeat(1, { extra: 1 })).toBe('bad-content');
    const { session: _gone, ...noSession } = content.seats[1] as Record<string, unknown>;
    const seats = content.seats.map((s, k) => (k === 1 ? noSession : s));
    expect(
      codeOf(() =>
        parseRoot(resign(rootEv, () => ({ content: canonicalJson({ ...content, seats }) }), A.sk)),
      ),
    ).toBe('bad-content');
  });

  it('the e tags are one per seat, in seat order, with seat:<i> markers and an id', () => {
    expect(withTags((t) => [...others(t), ...eTags(t).reverse()])).toBe('bad-tag');
    // Two well-formed e tags but three content seats: the cross-check is on the content.
    expect(withTags((t) => [...others(t), ...eTags(t).slice(0, 2)])).toBe('bad-content');
    expect(
      withTags((t) =>
        t.map((x) => (x[0] === 'e' && x[3] === 'seat:1' ? ['e', x[1] as string, '', 'seat:01'] : x)),
      ),
    ).toBe('bad-tag');
    expect(
      withTags((t) => t.map((x) => (x[0] === 'e' && x[3] === 'seat:1' ? ['e', 'ab', '', 'seat:1'] : x))),
    ).toBe('bad-tag');
    expect(
      withTags((t) => t.map((x) => (x[0] === 'e' && x[3] === 'seat:1' ? ['e', x[1] as string, ''] : x))),
    ).toBe('bad-tag');
    expect(
      withTags((t) =>
        t.map((x) => (x[0] === 'e' && x[3] === 'seat:1' ? ['e', x[1] as string, 'http://x', 'seat:1'] : x)),
      ),
    ).toBe('bad-tag');
    expect(
      withTags((t) =>
        t.map((x) => (x[0] === 'e' && x[3] === 'seat:1' ? ['e', x[1] as string, '', 'seat:1'] : x)),
      ),
    ).toBe('accepted');
    expect(
      withTags((t) => t.map((x) => (x[0] === 'e' && x[3] === 'seat:2' ? ['e', jA.id, '', 'seat:2'] : x))),
    ).toBe('bad-tag');
  });

  it('the rules-hash is hex64 and the deadline one of DEADLINES', () => {
    expect(withTags((t) => t.map((x) => (x[0] === 'rules-hash' ? ['rules-hash', 'AB'.repeat(32)] : x)))).toBe(
      'bad-tag',
    );
    expect(withTags((t) => t.map((x) => (x[0] === 'deadline' ? ['deadline', '100'] : x)))).toBe('bad-tag');
    expect(withTags((t) => t.map((x) => (x[0] === 'a' ? ['a', 'nope'] : x)))).toBe('bad-tag');
  });

  it('the content seats are a non-empty list matching the e tags', () => {
    expect(
      codeOf(() =>
        parseRoot(resign(rootEv, () => ({ content: canonicalJson({ ...content, seats: [] }) }), A.sk)),
      ),
    ).toBe('bad-content');
    expect(
      codeOf(() =>
        parseRoot(resign(rootEv, () => ({ content: canonicalJson({ ...content, seats: {} }) }), A.sk)),
      ),
    ).toBe('bad-content');
  });
});

/* ------------------------------------------------------------------------ validateRoot (Focus 3) */

describe('validateRoot', () => {
  const ok = (r: ParsedRoot, joins: ParsedJoin[], t: ParsedTable = table) =>
    validateRoot(r, t, byId(...joins), modules);
  const problemsOf = (joins: ParsedJoin[], t: ParsedTable = table) =>
    ok(parseRoot(rootEvent(joins, t)), joins, t);

  it('a valid 3-seat root, 1 invited and 1 open seat, validates', () => {
    expect(ok(root, [jA, jB, jC])).toEqual([]);
  });

  it('any seat order chosen by the creator validates', () => {
    expect(problemsOf([jC, jA, jB])).toEqual([]);
  });

  it('a seat pointing to a Join of another table fails', () => {
    const other = join(C, { address: tableAddress(A.npub, 'another-table') });
    expect(problemsOf([jA, jB, other])).toContainEqual(expect.stringMatching(/seat 2: .*another table/));
  });

  it('a duplicate npub fails', () => {
    const again = join(B, { sessionSk: D.sessionSk });
    expect(problemsOf([jA, jB, again])).toContainEqual(expect.stringMatching(/npub .*more than once/));
  });

  it('a duplicate session fails', () => {
    expect(problemsOf([jA, jB, join(C, { sessionSk: B.sessionSk })])).toContainEqual(
      expect.stringMatching(/session .*more than once/),
    );
  });

  it('a duplicate deck key fails', () => {
    const twin = player('open', B.x);
    expect(problemsOf([jA, jB, join(twin)])).toContainEqual(
      expect.stringMatching(/deck key .*more than once/),
    );
  });

  it('a bad proof of knowledge fails', () => {
    expect(problemsOf([jA, jB, join(C, { pokSession: D.session })])).toContainEqual(
      expect.stringMatching(/seat 2: .*proof of knowledge/),
    );
  });

  it('a rules-hash mismatch fails', () => {
    expect(ok({ ...root, rulesHash: rulesHash({ other: true }) }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/rules-hash/),
    );
  });

  it('a version mismatch with the module fails', () => {
    const old = parseTable(tableEvent({ version: '0.0.1' }));
    expect(problemsOf([jA, jB, jC], old)).toContainEqual(expect.stringMatching(/version 0\.0\.1 .*module/));
  });

  it('a version that differs from the table fails', () => {
    expect(ok({ ...root, version: '9.9.9' }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/version .*table/),
    );
  });

  it('a seat count that differs from the table fails', () => {
    expect(problemsOf([jA, jB])).toContainEqual(expect.stringMatching(/2 seats.*table has 3/));
  });

  it('a Join whose pubkey is neither invited nor taking an open seat fails', () => {
    expect(problemsOf([jA, join(C), join(D)])).toContainEqual(
      expect.stringMatching(/not invited.*open seats/),
    );
  });

  it('a root not signed by the table creator fails', () => {
    const forged = parseRoot(rootEvent([jA, jB, jC], table, RULES, E.sk));
    expect(ok(forged, [jA, jB, jC])).toContainEqual(expect.stringMatching(/creator/));
  });

  it('a root for another table address fails', () => {
    expect(ok({ ...root, tableAddress: tableAddress(A.npub, 'x') }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/table address/),
    );
  });

  it('a game or deadline that differs from the table fails', () => {
    expect(ok({ ...root, game: 'other' }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/game .*table/),
    );
    expect(ok({ ...root, deadline: 86400 }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/deadline .*table/),
    );
  });

  it('an unknown join id fails', () => {
    expect(ok(root, [jA, jB])).toContainEqual(expect.stringMatching(/seat 2: unknown join/));
  });

  it('a seat whose fields differ from its Join fails', () => {
    const seats = root.seats.map((s, i) => (i === 1 ? { ...s, session: D.session } : s));
    expect(ok({ ...root, seats }, [jA, jB, jC])).toContainEqual(expect.stringMatching(/seat 1: .*session/));
    const keys = root.seats.map((s, i) => (i === 1 ? { ...s, deckKey: D.X } : s));
    expect(ok({ ...root, seats: keys }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/seat 1: .*deck key/),
    );
    const npubs = root.seats.map((s, i) => (i === 1 ? { ...s, npub: D.npub } : s));
    expect(ok({ ...root, seats: npubs }, [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/seat 1: .*npub/),
    );
  });

  it('a root without the creator seated fails', () => {
    const t = parseTable(tableEvent({ invited: [B.npub, C.npub], open: 0 }));
    const joins = [
      join(B, { address: t.address, table: t }),
      join(C, { address: t.address, table: t }),
      join(D, { address: t.address, table: t }),
    ];
    expect(problemsOf(joins, t)).toContainEqual(expect.stringMatching(/creator .*seat/));
  });

  it('rules that differ from the table fail', () => {
    const rules = { ...RULES, maxPlayers: 5 };
    expect(ok(parseRoot(rootEvent([jA, jB, jC], table, rules)), [jA, jB, jC])).toContainEqual(
      expect.stringMatching(/rules .*table/),
    );
  });

  it('an unknown game module fails', () => {
    const t = parseTable(tableEvent({ game: 'no-such-game' }));
    expect(validateRoot({ ...root, game: 'no-such-game' }, t, byId(jA, jB, jC), modules)).toContainEqual(
      expect.stringMatching(/no module/),
    );
  });

  it('rules the module rejects fail', () => {
    const bad = { ...RULES, minPlayers: 99 };
    const t = parseTable(tableEvent({ rules: bad }));
    const joins = [A, B, C].map((p) => join(p, { address: t.address, table: t }));
    expect(ok(parseRoot(rootEvent(joins, t, bad)), joins, t)).toContainEqual(
      expect.stringMatching(/rules rejected/),
    );
  });

  it('a seat count outside the module seat range fails', () => {
    const t = parseTable(tableEvent({ seats: 2, invited: [B.npub], open: 0 }));
    const joins = [A, B].map((p) => join(p, { address: t.address, table: t }));
    expect(problemsOf(joins, t)).toContainEqual(expect.stringMatching(/seat range/));
  });

  it('a Join committed to other rules fails, even when the table was republished with them', () => {
    const other = { ...RULES, maxPlayers: 5 };
    const republished = parseTable(tableEvent({ rules: other }));
    const rootOther = parseRoot(rootEvent([jA, jB, jC], republished, other));
    // The joins committed to RULES; the table the client holds now says `other`, and so does the root.
    expect(ok(rootOther, [jA, jB, jC], republished)).toContainEqual(
      expect.stringMatching(/seat 0: .*other rules/),
    );
  });

  it('a Join committed to another version fails', () => {
    const j = join(C, { version: '0.0.1' });
    expect(problemsOf([jA, jB, j])).toContainEqual(expect.stringMatching(/seat 2: .*version 0\.0\.1/));
  });

  it('a deck key whose x-coordinate is the session key fails', () => {
    const x = bytesToHex(C.X.toBytes(true).slice(1));
    const clash = join(C, { sessionSk: scalarBytes(C.x) });
    expect(clash.session).toBe(x);
    expect(problemsOf([jA, jB, clash])).toContainEqual(expect.stringMatching(/seat 2: .*x-coordinate/));
  });

  it("a session key equal to another seat's npub fails", () => {
    const clash = join(C, { sessionSk: A.sk });
    expect(problemsOf([jA, jB, clash])).toContainEqual(expect.stringMatching(/seat 2: .*session key.*npub/));
  });

  it('a joint key equal to the identity fails (D024)', () => {
    const third = player('open', (2n * q - A.x - B.x) % q);
    expect(problemsOf([jA, jB, join(third)])).toContainEqual(expect.stringMatching(/joint key/));
  });

  it('never throws, even on a hostile join map', () => {
    const hostile = new Map<Hex, ParsedJoin>([[jA.id, null as unknown as ParsedJoin]]);
    expect(validateRoot(root, table, hostile, modules).length).toBeGreaterThan(0);
  });
});

describe('protocol versions in the lobby (PROTOCOL-v2 §2, §10)', () => {
  const table2 = parseTable(tableEvent({ proto: '2' }));
  const j2 = (p: Player, o: JoinOpts = {}) => join(p, { table: table2, ...o });
  const [kA, kB, kC] = [j2(A), j2(B), j2(C)];
  const rootAt = (t: ParsedTable, joins: ParsedJoin[], proto?: Proto) =>
    parseRoot(sign(rootTemplate({ table: t, joins, rules: RULES, relays: RELAYS, proto }, T0 + 100), A.sk));
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  type Registry = ReadonlyMap<string, GameModule<any, any, any>>;
  const only = (protocols: readonly (1 | 2)[]): Registry =>
    new Map([[chainReaction.id, { ...chainReaction, protocols }]]);

  it("templates carry the table's proto: a proto-2 table, its Joins and root parse as proto 2", () => {
    expect(table2.proto).toBe('2');
    expect([kA, kB, kC].map((j) => j.proto)).toEqual(['2', '2', '2']);
    expect(rootAt(table2, [kA, kB, kC]).proto).toBe('2');
    expect(root.proto).toBe('1');
  });

  it("V2-02 (partial) validateRoot rejects a root or a Join whose proto differs from its table's", () => {
    expect(validateRoot(rootAt(table2, [kA, kB, kC]), table2, byId(kA, kB, kC), modules)).toEqual([]);
    expect(validateRoot(rootAt(table2, [kA, kB, kC], '1'), table2, byId(kA, kB, kC), modules)).toContainEqual(
      "proto 1 differs from the table's 2",
    );
    expect(validateRoot(rootAt(table, [jA, jB, jC], '2'), table, byId(jA, jB, jC), modules)).toContainEqual(
      "proto 2 differs from the table's 1",
    );
    const old = j2(C, { proto: '1' });
    expect(validateRoot(rootAt(table2, [kA, kB, old]), table2, byId(kA, kB, old), modules)).toContainEqual(
      'seat 2: the join is for proto 1',
    );
    const ahead = join(C, { proto: '2' });
    expect(validateRoot(rootAt(table, [jA, jB, ahead]), table, byId(jA, jB, ahead), modules)).toContainEqual(
      'seat 2: the join is for proto 2',
    );
    // An object without `proto` (a caller's hand-made v1 object) is proto 1.
    const bare = <T extends { proto: Proto }>(o: T) => ({ ...o, proto: undefined }) as unknown as T;
    expect(validateRoot(bare(root), bare(table), byId(...[jA, jB, jC].map(bare)), modules)).toEqual([]);
    // Under a proto-2 table such objects are reported as proto 1, never "proto undefined" (T2/T3 review I3).
    const bareProblems = validateRoot(
      bare(rootAt(table2, [kA, kB, kC])),
      table2,
      byId(kA, kB, bare(kC)),
      modules,
    );
    expect(bareProblems).toContainEqual("proto 1 differs from the table's 2");
    expect(bareProblems).toContainEqual('seat 2: the join is for proto 1');
    expect(bareProblems.join('; ')).not.toContain('undefined');
  });

  it('V2-05 (partial) validateRoot and validateTable reject a module version that does not support the proto', () => {
    const r1 = root;
    const r2 = rootAt(table2, [kA, kB, kC]);
    const v1 = byId(jA, jB, jC);
    const v2 = byId(kA, kB, kC);
    expect(validateRoot(r1, table, v1, only([1]))).toEqual([]);
    expect(validateRoot(r2, table2, v2, only([1]))).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 2`,
    ]);
    expect(validateRoot(r2, table2, v2, only([2]))).toEqual([]);
    expect(validateRoot(r1, table, v1, only([2]))).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 1`,
    ]);
    // A module without `protocols` runs under protocol 1 only.
    const bareModule = { ...chainReaction } as Record<string, unknown>;
    delete bareModule.protocols;
    const noList = new Map([[chainReaction.id, bareModule]]) as unknown as Registry;
    expect(validateRoot(r1, table, v1, noList)).toEqual([]);
    expect(validateRoot(r2, table2, v2, noList)).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 2`,
    ]);

    expect(validateTable(table, only([1]))).toEqual([]);
    expect(validateTable(table2, only([1]))).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 2`,
    ]);
    expect(validateTable(table2, modules)).toEqual([]);
    expect(validateTable(table, only([2]))).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 1`,
    ]);
    expect(validateTable(table, new Map())).toEqual([
      `there is no module for game chain-reaction ${chainReaction.version}`,
    ]);
    expect(validateTable(parseTable(tableEvent({ seats: 9, open: 7 })), modules)).toEqual([
      "9 seats are outside the module's seat range 3 to 6",
    ]);
  });

  it('a version kept under `id@version` validates the games of that version, with its own protocols (D-B)', () => {
    const newer = { ...chainReaction, version: '99.0.0', protocols: [2] as const };
    const kept = (protocols: readonly (1 | 2)[]): Registry =>
      new Map([
        [chainReaction.id, newer],
        [`${chainReaction.id}@${chainReaction.version}`, { ...chainReaction, protocols }],
      ]);
    expect(validateRoot(root, table, byId(jA, jB, jC), kept([1]))).toEqual([]);
    expect(validateTable(table, kept([1]))).toEqual([]);
    expect(validateRoot(rootAt(table2, [kA, kB, kC]), table2, byId(kA, kB, kC), kept([1]))).toEqual([
      `chain-reaction ${chainReaction.version} does not support proto 2`,
    ]);
    // Without the kept version the v1 message stands: the module's current version is another.
    const none: Registry = new Map([[chainReaction.id, newer]]);
    expect(validateRoot(root, table, byId(jA, jB, jC), none)).toContainEqual(
      `version ${chainReaction.version} is not the module's version 99.0.0`,
    );
  });
});
