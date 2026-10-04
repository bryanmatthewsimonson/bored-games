/**
 * pnpm --filter @bored-games/protocol vectors
 *
 * Writes the protocol 2 parser vectors (PROTOCOL-v2 §12.2 items 3 and 4):
 * - `test/vectors/v2-parsers.json`: signed events with the parser, the game's proto and the verdict (accepted, with
 *   a summary of the parse, or the `ProtocolError` code): Shares (card and roll variants), end and stats
 *   attestations, Device notes, and one event of each in-game kind under every proto tag against v1 and v2 games.
 * - `test/vectors/loghash.json`: real signed Moves of a 2-seat, 4-card game at proto 2 and the log hash of three
 *   lines (the empty line at the root, a shuffle-only line, a line through game actions), with the end
 *   attestation of the last.
 *
 * Every key and nonce comes from a fixed seed. Parser vectors check shapes only: the shares' proofs are real deck
 * shares but are not checked here (roll points and contributions are packages/deck's vector 1).
 * `test/vectors-v2.test.ts` checks that regenerating gives the files byte for byte and that every verdict holds.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  encodePoint,
  encodeShare,
  G,
  initialDeck,
  jointKey,
  makeShare,
  proveShuffle,
  randomScalar,
  shuffleDeck,
} from '@bored-games/deck';
import { canonicalJson, createRng } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import {
  attestTemplate,
  cardSharesTemplate,
  deviceNoteTemplate,
  endAttestTemplate,
  logHash,
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
  timeoutTemplate,
} from '../src/game.ts';
import type { Proto } from '../src/kinds.ts';
import { isProtocolError } from '../src/lobby.ts';
import { type EventTemplate, finalizeEvent, getPublicKey, type Hex, type NostrEvent } from '../src/nostr.ts';

const SEED = 'bored-games/protocol/v2-parsers';
const T0 = 1_790_000_000;

/** A byte source from `seed`. */
function seededRandom(seed: string): (n: number) => Uint8Array {
  const rng = createRng(seed);
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

const hexOf = (label: string): Hex => bytesToHex(sha256(utf8ToBytes(label)));
const keyOf = (label: string): Uint8Array => sha256(utf8ToBytes(label));

/** The parsers a vector names, each with the game's proto. */
export type ParserName =
  | 'sharesV2'
  | 'attestV2'
  | 'deviceNote'
  | 'move'
  | 'timeout'
  | 'secret'
  | 'resign'
  | 'shares'
  | 'attest';

export interface ParserCase {
  name: string;
  parser: ParserName;
  /** The game's proto: what an in-game parser expects. The v2-only parsers always expect `"2"`. */
  game: Proto;
  event: NostrEvent;
  /** `accepted`, or the `ProtocolError` code. */
  verdict: string;
  /** For an accepted case: what the parse returned, in plain JSON. */
  parsed: unknown;
}

const DECK_SIZE = 4;

/** Run the named parser on `ev` for a game at `game`. Throws what the parser throws. */
export function runParser(parser: ParserName, game: Proto, ev: unknown): unknown {
  switch (parser) {
    case 'sharesV2':
      return parseSharesV2(ev);
    case 'attestV2':
      return parseAttestV2(ev);
    case 'deviceNote':
      return parseDeviceNote(ev);
    case 'move':
      return parseMove(ev, DECK_SIZE, game);
    case 'timeout':
      return parseTimeout(ev, game);
    case 'secret':
      return parseSecret(ev, game);
    case 'resign':
      return parseResign(ev, false, game);
    case 'shares':
      return parseShares(ev);
    case 'attest':
      return parseAttest(ev);
  }
}

/** A parse result as plain JSON: shares by encoding, scalars as decimal strings. */
export function plain(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v !== 'object' || v === null) return v;
  const o = v as Record<string, unknown>;
  if ('pos' in o && 'share' in o) return encodeShare(o as unknown as PosShare);
  if (typeof (o as { toHex?: unknown }).toHex === 'function')
    return (o as { toHex(c: boolean): string }).toHex(true);
  return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, plain(x)]));
}

/** The verdict and summary of running `parser` on `ev`. */
export function verdictOf(
  parser: ParserName,
  game: Proto,
  ev: unknown,
): { verdict: string; parsed: unknown } {
  try {
    return { verdict: 'accepted', parsed: plain(runParser(parser, game, ev)) };
  } catch (e) {
    if (isProtocolError(e)) return { verdict: e.code, parsed: null };
    throw e;
  }
}

export function generateParserVectors(): {
  version: number;
  seed: string;
  rootId: Hex;
  session: Hex;
  npub: Hex;
  cases: ParserCase[];
} {
  const rnd = seededRandom(SEED);
  const sessionSk = keyOf(`${SEED}:session`);
  const npubSk = keyOf(`${SEED}:npub`);
  const ROOT = hexOf(`${SEED}:root`);
  const HEAD = hexOf(`${SEED}:head`);
  const MOVE = hexOf(`${SEED}:move`);
  const LOG = hexOf(`${SEED}:log`);

  // Real shares of a shuffled 8-card deck by one seat, at positions 0..7.
  const x = randomScalar(rnd);
  const deck = shuffleDeck(initialDeck('tiles', 8), G.multiply(x), rnd).out;
  const share = (pos: number): PosShare => ({
    pos,
    share: makeShare(x, deck[pos] as (typeof deck)[number], { rootId: ROOT, deckId: 'tiles', pos }, rnd),
  });
  const wire = (pos: number) => encodeShare(share(pos));

  const cases: ParserCase[] = [];
  const sign = (t: EventTemplate, sk = sessionSk): NostrEvent => finalizeEvent(t, sk, rnd);
  const add = (name: string, parser: ParserName, game: Proto, event: NostrEvent): void => {
    cases.push({ name, parser, game, event, ...verdictOf(parser, game, event) });
  };
  /** `t` with its tags replaced by `tags(t.tags)`. */
  const tagged = (t: EventTemplate, tags: (old: string[][]) => string[][]): EventTemplate => ({
    ...t,
    tags: tags(t.tags.map((x) => [...x])),
  });
  const content = (t: EventTemplate, c: unknown): EventTemplate => ({ ...t, content: canonicalJson(c) });
  const rootTag = ['e', ROOT, '', 'root'];
  const anchorTag = ['e', HEAD, '', 'anchor'];

  /* Shares, card and roll variants (PROTOCOL-v2 §4.2). */
  const card = cardSharesTemplate({ rootId: ROOT, anchorId: HEAD, shares: [share(1), share(4)] }, T0);
  const roll = rollSharesTemplate(
    { rootId: ROOT, anchorId: HEAD, moveId: MOVE, shares: [share(0), share(1)] },
    T0,
  );
  add('shares: card variant, anchored', 'sharesV2', '2', sign(card));
  add(
    'shares: card variant anchored on the root (no move held)',
    'sharesV2',
    '2',
    sign(cardSharesTemplate({ rootId: ROOT, anchorId: ROOT, shares: [share(2)] }, T0)),
  );
  add('shares: roll variant, anchored', 'sharesV2', '2', sign(roll));
  add(
    'shares: missing anchor tag',
    'sharesV2',
    '2',
    sign(tagged(card, (t) => t.filter((x) => x[3] !== 'anchor'))),
  );
  add('shares: doubled anchor tag', 'sharesV2', '2', sign(tagged(card, (t) => [...t, anchorTag])));
  add(
    'shares: two anchor tags, no root tag',
    'sharesV2',
    '2',
    sign(tagged(card, (t) => [anchorTag, ['e', MOVE, '', 'anchor'], ...t.filter((x) => x[0] !== 'e')])),
  );
  add('shares: a third e tag', 'sharesV2', '2', sign(tagged(card, (t) => [...t, ['e', MOVE, '', 'prev']])));
  add(
    'shares: missing root tag',
    'sharesV2',
    '2',
    sign(tagged(card, (t) => t.filter((x) => x[3] !== 'root'))),
  );
  add(
    'shares: anchor not 64 lowercase hex',
    'sharesV2',
    '2',
    sign(
      tagged(card, (t) => t.map((x) => (x[3] === 'anchor' ? ['e', HEAD.toUpperCase(), '', 'anchor'] : x))),
    ),
  );
  add(
    'shares: the v1 form (root tag only) at proto 2',
    'sharesV2',
    '2',
    sign(tagged(card, (t) => t.filter((x) => x[3] !== 'anchor'))),
  );
  add('shares: empty list (card)', 'sharesV2', '2', sign(content(card, { shares: [], type: 'shares' })));
  add(
    'shares: empty list (roll)',
    'sharesV2',
    '2',
    sign(content(roll, { move: MOVE, shares: [], type: 'roll' })),
  );
  add(
    'shares: descending pos',
    'sharesV2',
    '2',
    sign(content(card, { shares: [wire(4), wire(1)], type: 'shares' })),
  );
  add(
    'shares: repeated pos',
    'sharesV2',
    '2',
    sign(content(card, { shares: [wire(3), wire(3)], type: 'shares' })),
  );
  add(
    'shares: card variant with a move key',
    'sharesV2',
    '2',
    sign(content(card, { move: MOVE, shares: [wire(1)], type: 'shares' })),
  );
  add(
    'shares: roll variant without its move key',
    'sharesV2',
    '2',
    sign(content(roll, { shares: [wire(0)], type: 'roll' })),
  );
  add(
    'shares: an extra key',
    'sharesV2',
    '2',
    sign(content(card, { extra: 1, shares: [wire(1)], type: 'shares' })),
  );
  add(
    'shares: type other than shares or roll',
    'sharesV2',
    '2',
    sign(content(card, { shares: [wire(1)], type: 'deal' })),
  );
  add(
    'shares: non-hex move',
    'sharesV2',
    '2',
    sign(content(roll, { move: `${MOVE.slice(0, 63)}g`, shares: [wire(0)], type: 'roll' })),
  );
  add(
    'shares: uppercase move',
    'sharesV2',
    '2',
    sign(content(roll, { move: MOVE.toUpperCase(), shares: [wire(0)], type: 'roll' })),
  );
  add(
    'shares: a share that fails the strict codec',
    'sharesV2',
    '2',
    sign(content(card, { shares: [{ ...wire(1), pos: -1 }], type: 'shares' })),
  );

  /* End attestations (PROTOCOL-v2 §4.3). */
  const end = (kind: 'over' | 'claim' | 'resign', forfeit: number[]) =>
    endAttestTemplate({ rootId: ROOT, headId: HEAD, end: { kind, forfeit, logHash: LOG } }, T0);
  const over = end('over', []);
  add('end attestation: over', 'attestV2', '2', sign(over));
  add('end attestation: claim forfeiting one seat', 'attestV2', '2', sign(end('claim', [1])));
  add('end attestation: claim forfeiting two seats', 'attestV2', '2', sign(end('claim', [0, 2])));
  add('end attestation: resign', 'attestV2', '2', sign(end('resign', [1])));
  add(
    'end attestation: signed by the npub (the parser is signer-agnostic)',
    'attestV2',
    '2',
    sign(over, npubSk),
  );
  add(
    'end attestation: missing head tag',
    'attestV2',
    '2',
    sign(tagged(over, (t) => t.filter((x) => x[3] !== 'head'))),
  );
  add(
    'end attestation: a third e tag',
    'attestV2',
    '2',
    sign(tagged(over, (t) => [...t, ['e', MOVE, '', 'prev']])),
  );
  add(
    'end attestation: a second root tag in place of head',
    'attestV2',
    '2',
    sign(tagged(over, (t) => t.map((x) => (x[3] === 'head' ? rootTag : x)))),
  );
  const endContent = (e: Record<string, unknown>) => content(over, { end: e });
  add(
    'end attestation: over with a forfeit',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [1], kind: 'over', logHash: LOG })),
  );
  add(
    'end attestation: resign with no seat',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [], kind: 'resign', logHash: LOG })),
  );
  add(
    'end attestation: resign with two seats',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [0, 1], kind: 'resign', logHash: LOG })),
  );
  add(
    'end attestation: claim with no seat',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [], kind: 'claim', logHash: LOG })),
  );
  add(
    'end attestation: unsorted forfeit',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [2, 0], kind: 'claim', logHash: LOG })),
  );
  add(
    'end attestation: repeated forfeit seat',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [1, 1], kind: 'claim', logHash: LOG })),
  );
  add(
    'end attestation: negative seat',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [-1], kind: 'claim', logHash: LOG })),
  );
  add(
    'end attestation: kind fork',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [1], kind: 'fork', logHash: LOG })),
  );
  add(
    'end attestation: bad logHash',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [], kind: 'over', logHash: 'x' })),
  );
  add(
    'end attestation: an extra key in end',
    'attestV2',
    '2',
    sign(endContent({ audit: 'pass', forfeit: [], kind: 'over', logHash: LOG })),
  );
  add(
    'end attestation: a missing key in end',
    'attestV2',
    '2',
    sign(endContent({ forfeit: [], kind: 'over' })),
  );
  add(
    'end attestation: an extra top-level key',
    'attestV2',
    '2',
    sign(content(over, { audit: 'pass', end: { forfeit: [], kind: 'over', logHash: LOG } })),
  );

  /* Stats attestations (PROTOCOL-v2 §4.3, §7.4). */
  const outcome = { places: [1, 2, 3], reason: 'over', scores: [30, 20, 10] };
  const stats = attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome }, T0, '2');
  add('stats attestation', 'attestV2', '2', sign(stats, npubSk));
  add(
    'stats attestation: an audit failure',
    'attestV2',
    '2',
    sign(
      attestTemplate(
        { rootId: ROOT, audit: { fail: [2], reason: 'timeout' }, logHash: LOG, outcome },
        T0,
        '2',
      ),
      npubSk,
    ),
  );
  const resigned = { ...outcome, unrated: true as const, endedBy: { type: 'resign' as const, seat: 2 } };
  add(
    'stats attestation: endedBy resign',
    'attestV2',
    '2',
    sign(attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: resigned }, T0, '2'), npubSk),
  );
  const forked = { ...outcome, unrated: true as const, endedBy: { type: 'fork' as const, seat: 2 } };
  add(
    'stats attestation: endedBy fork (no frozen ends in v2)',
    'attestV2',
    '2',
    // attestTemplate refuses `fork` at proto 2, so the case is the v1 form with its proto tag set to "2".
    sign(
      tagged(attestTemplate({ rootId: ROOT, audit: 'pass', logHash: LOG, outcome: forked }, T0), (t) =>
        t.map((x) => (x[0] === 'proto' ? ['proto', '2'] : x)),
      ),
      npubSk,
    ),
  );
  add(
    'stats attestation: with a head tag',
    'attestV2',
    '2',
    sign(
      tagged(stats, (t) => [t[0] as string[], ['e', HEAD, '', 'head'], ...t.slice(1)]),
      npubSk,
    ),
  );
  add(
    'stats attestation: a missing key',
    'attestV2',
    '2',
    sign(content(stats, { audit: 'pass', logHash: LOG }), npubSk),
  );

  /* Device notes (PROTOCOL-v2 §4.4). */
  const DEVICE = bytesToHex(rnd(16));
  const note = deviceNoteTemplate({ rootId: ROOT, device: DEVICE, n: 1 }, T0);
  const noteContent = (device: unknown, n: unknown) => content(note, { device, n, type: 'device' });
  add('device note: n = 1', 'deviceNote', '2', sign(note));
  add(
    'device note: n = 42',
    'deviceNote',
    '2',
    sign(deviceNoteTemplate({ rootId: ROOT, device: DEVICE, n: 42 }, T0)),
  );
  add('device note: device of 31 hex characters', 'deviceNote', '2', sign(noteContent(DEVICE.slice(1), 1)));
  add('device note: device of 34 hex characters', 'deviceNote', '2', sign(noteContent(`${DEVICE}00`, 1)));
  add('device note: uppercase device', 'deviceNote', '2', sign(noteContent(DEVICE.toUpperCase(), 1)));
  add('device note: non-hex device', 'deviceNote', '2', sign(noteContent(`${DEVICE.slice(0, 31)}z`, 1)));
  add('device note: n = 0', 'deviceNote', '2', sign(noteContent(DEVICE, 0)));
  add('device note: n = -1', 'deviceNote', '2', sign(noteContent(DEVICE, -1)));
  add('device note: n = 1.5', 'deviceNote', '2', sign(noteContent(DEVICE, 1.5)));
  add('device note: n as a string', 'deviceNote', '2', sign(noteContent(DEVICE, '1')));
  add(
    'device note: n with a leading zero',
    'deviceNote',
    '2',
    sign({
      ...note,
      content: `{"device":"${DEVICE}","n":01,"type":"device"}`,
    }),
  );
  add(
    'device note: n as 1.0 (not canonical)',
    'deviceNote',
    '2',
    sign({
      ...note,
      content: `{"device":"${DEVICE}","n":1.0,"type":"device"}`,
    }),
  );
  add(
    'device note: wrong type',
    'deviceNote',
    '2',
    sign(content(note, { device: DEVICE, n: 1, type: 'note' })),
  );
  add(
    'device note: a head tag',
    'deviceNote',
    '2',
    sign(tagged(note, (t) => [...t, ['e', HEAD, '', 'head']])),
  );
  add(
    'device note: no root tag',
    'deviceNote',
    '2',
    sign(tagged(note, (t) => t.filter((x) => x[0] !== 'e'))),
  );

  /* Proto: one event per in-game kind with each proto tag form, against a v1 and a v2 game (PROTOCOL-v2 §2). */
  const forms: [string, string[][]][] = [
    ['"1"', [['proto', '1']]],
    ['"2"', [['proto', '2']]],
    ['"3"', [['proto', '3']]],
    ['no proto tag', []],
    [
      'two "1" tags',
      [
        ['proto', '1'],
        ['proto', '1'],
      ],
    ],
    [
      '"1" and "2"',
      [
        ['proto', '1'],
        ['proto', '2'],
      ],
    ],
    ['a 3-item tag', [['proto', '2', '']]],
  ];
  const action = { type: 'action' as const, action: { type: 'pass', actor: 0 }, reveals: [], shares: [] };
  const bases: [string, (game: Proto) => ParserName, EventTemplate][] = [
    ['move', () => 'move', moveTemplate({ rootId: ROOT, prevId: HEAD, seq: 5, content: action }, T0)],
    ['timeout claim', () => 'timeout', timeoutTemplate({ rootId: ROOT, headId: HEAD, seat: 1 }, T0)],
    ['secret reveal', () => 'secret', secretTemplate({ rootId: ROOT, deckSecret: x }, T0)],
    ['resign (deckless)', () => 'resign', resignTemplate({ rootId: ROOT, headId: HEAD }, T0)],
    ['card shares (v2 form)', (g) => (g === '1' ? 'shares' : 'sharesV2'), card],
    ['end attestation', (g) => (g === '1' ? 'attest' : 'attestV2'), over],
  ];
  for (const [kind, parserFor, base] of bases) {
    for (const [form, protoTags] of forms) {
      const ev = sign(tagged(base, (t) => [...t.filter((x) => x[0] !== 'proto'), ...protoTags]));
      for (const game of ['1', '2'] as const)
        add(`proto: ${kind} with ${form}, in a v${game} game`, parserFor(game), game, ev);
    }
  }

  return {
    version: 1,
    seed: SEED,
    rootId: ROOT,
    session: getPublicKey(sessionSk),
    npub: getPublicKey(npubSk),
    cases,
  };
}

export interface LogHashLine {
  name: string;
  /** The line's head: the root id for the empty line. */
  head: Hex;
  /** The chain's move ids from move 1 to the head, in `seq` order. */
  moveIds: Hex[];
  logHash: Hex;
}

export function generateLogHashVectors(): {
  version: number;
  seed: string;
  rootId: Hex;
  deckId: string;
  size: number;
  seats: { seat: number; session: Hex }[];
  jointKey: string;
  moves: NostrEvent[];
  lines: LogHashLine[];
  endAttestation: NostrEvent;
} {
  const seed = 'bored-games/protocol/v2-loghash';
  const rnd = seededRandom(seed);
  const ROOT = hexOf(`${seed}:root`);
  const deckId = 'tiles';
  const sks = [0, 1].map((k) => keyOf(`${seed}:session:${k}`));
  const secrets = [randomScalar(rnd), randomScalar(rnd)];
  const X = jointKey(secrets.map((s) => G.multiply(s)));
  const moves: NostrEvent[] = [];
  let input = initialDeck(deckId, DECK_SIZE);
  let prev = ROOT;
  for (const seat of [0, 1]) {
    const { out, psi, rPrime } = shuffleDeck(input, X, rnd);
    const proof = proveShuffle(input, out, X, psi, rPrime, { rootId: ROOT, seat, deckId }, rnd);
    const t = moveTemplate(
      { rootId: ROOT, prevId: prev, seq: seat + 1, content: { type: 'shuffle', deck: out, proof } },
      T0 + seat,
      '2',
    );
    const ev = finalizeEvent(t, sks[seat] as Uint8Array, rnd);
    moves.push(ev);
    prev = ev.id;
    input = out;
  }
  for (const [i, seat] of [0, 1].entries()) {
    const content = {
      type: 'action' as const,
      action: { type: 'pass', actor: seat },
      reveals: [],
      shares: [],
    };
    const t = moveTemplate({ rootId: ROOT, prevId: prev, seq: 3 + i, content }, T0 + 10 + i, '2');
    const ev = finalizeEvent(t, sks[seat] as Uint8Array, rnd);
    moves.push(ev);
    prev = ev.id;
  }
  const ids = moves.map((m) => m.id);
  const line = (name: string, n: number): LogHashLine => ({
    name,
    head: n === 0 ? ROOT : (ids[n - 1] as Hex),
    moveIds: ids.slice(0, n),
    logHash: logHash(ids.slice(0, n)),
  });
  const lines = [
    line('the empty line (the root)', 0),
    line('a shuffle-only line', 2),
    line('a line through game actions', 4),
  ];
  const last = lines[2] as LogHashLine;
  const endAttestation = finalizeEvent(
    endAttestTemplate(
      { rootId: ROOT, headId: last.head, end: { kind: 'over', forfeit: [], logHash: last.logHash } },
      T0 + 20,
    ),
    sks[0] as Uint8Array,
    rnd,
  );
  return {
    version: 1,
    seed,
    rootId: ROOT,
    deckId,
    size: DECK_SIZE,
    seats: sks.map((sk, seat) => ({ seat, session: getPublicKey(sk) })),
    jointKey: encodePoint(X),
    moves,
    lines,
    endAttestation,
  };
}

function main(): void {
  const dir = new URL('../test/vectors/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of [
    ['v2-parsers.json', generateParserVectors()],
    ['loghash.json', generateLogHashVectors()],
  ] as const) {
    const file = new URL(name, dir);
    const text = `${canonicalJson(data)}\n`;
    writeFileSync(file, text);
    console.info(`wrote ${fileURLToPath(file)} (${text.length} bytes)`);
  }
}

// `import.meta.url` is the real path; argv[1] may go through a symlink (a symlinked checkout, macOS /tmp).
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) main();
