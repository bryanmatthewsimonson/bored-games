import {
  type Ciphertext,
  DeckWireError,
  decodeDeck,
  decodeScalar,
  decodeShare,
  decodeShuffleProof,
  encodeDeck,
  encodeScalar,
  encodeShare,
  encodeShuffleProof,
  type Share,
  type ShuffleProof,
} from '@bored-games/deck';
import { canonicalJson } from '@bored-games/game-kit';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { ProtocolError } from './errors.ts';
import { KIND, type Proto } from './kinds.ts';
import { badContent, badTag, canonicalContent, decimal, hex64, list, parseEvent, record } from './lobby.ts';
import { type EventTemplate, type Hex, isHex64 } from './nostr.ts';
import { named, one } from './tags.ts';

/*
 * In-game events (PROTOCOL §4.4–§4.9): Move, Shares, Timeout claim, Secret reveal, Result attestation and Resign.
 * Templates build unsigned events; parsers take signed events from peers, run the same pipeline as the lobby
 * parsers (size cap, NIP-01 validity, kind, `proto` tag, required tags, canonical content, exact content shape)
 * and throw `ProtocolError` on anything else. Parsers check shapes only: proofs, owed shares, the `x·G = X_k`
 * check and the move's meaning belong to the session engine.
 *
 * Protocol versions (PROTOCOL-v2 §2, build plan D-F). The forms both versions share (Move, Timeout claim, Resign,
 * Secret reveal, and the v1 attestation's template, which a v2 game uses for its stats attestation) take the
 * game's proto, `'1'` by default, so every v1 caller and its error text are unchanged. The v1 Shares form and the
 * v1 attestation parser are v1 only. The v2-only forms have their own functions, which require `["proto","2"]`:
 * `cardSharesTemplate`, `rollSharesTemplate`, `parseSharesV2`, `endAttestTemplate`, `parseAttestV2`,
 * `deviceNoteTemplate` and `parseDeviceNote` (PROTOCOL-v2 §4).
 */

/* --------------------------------------------------------------------------------------------- types */

/** A decryption share for the deck position `pos` (PROTOCOL §5.4). */
export interface PosShare {
  pos: number;
  share: Share;
}

export type MoveContent =
  | { type: 'shuffle'; deck: Ciphertext[]; proof: ShuffleProof }
  | { type: 'action'; action: unknown; reveals: PosShare[]; shares: PosShare[] };

export interface MoveSpec {
  rootId: Hex;
  prevId: Hex;
  seq: number;
  content: MoveContent;
}

/** What every parsed in-game event carries: its own id, its signer (a session key) and its time. */
export interface Parsed {
  id: Hex;
  pubkey: Hex;
  createdAt: number;
}

export type ParsedMove = Parsed & { rootId: Hex; prevId: Hex; seq: number; content: MoveContent };

export interface SharesSpec {
  rootId: Hex;
  shares: PosShare[];
}

export type ParsedShares = Parsed & SharesSpec;

export interface TimeoutSpec {
  rootId: Hex;
  headId: Hex;
  seat: number;
}

export type ParsedTimeout = Parsed & TimeoutSpec;

export interface ResignSpec {
  rootId: Hex;
  /** The head the resigning seat saw when it resigned (PROTOCOL §4.9). */
  headId: Hex;
  /**
   * The resigning seat's deck secret `x_k` in a game with a deck (PROTOCOL §4.9, D052), so it owes nothing after
   * the resign; null (or absent) in a deckless game, where the content carries none.
   */
  secret?: bigint | null;
}

export type ParsedResign = Parsed & {
  rootId: Hex;
  headId: Hex;
  /** The seat's deck secret, a scalar in [0, q), when the game has a deck; null in a deckless game. */
  secret: bigint | null;
};

export interface SecretSpec {
  rootId: Hex;
  /** The seat's deck secret `x_k`, a scalar in [0, q). */
  deckSecret: bigint;
}

export type ParsedSecret = Parsed & SecretSpec;

export type Audit = 'pass' | { fail: number[]; reason: string };

/**
 * Who ended a game outside its rules (PROTOCOL §7, §8.3, D052): a Resign in a game of 3+ seats (`resign`), or an
 * ending branch that holds only because a deck secret froze its fork (`fork`, D056 fix round 2: the forker).
 */
export interface EndedBy {
  type: 'resign' | 'fork';
  seat: number;
}

/**
 * A result. `unrated` and `endedBy` are present only when a Resign ended a game of 3 or more seats (D052): such a
 * result does not count toward ratings, and records the seat that ended it. Absent everywhere else, so every other
 * result (and its attestation) is unchanged.
 */
export interface Outcome {
  places: number[];
  reason: string;
  scores: number[];
  unrated?: true;
  endedBy?: EndedBy;
}

export interface AttestSpec {
  rootId: Hex;
  audit: Audit;
  logHash: Hex;
  outcome: Outcome;
}

export type ParsedAttest = Parsed & AttestSpec;

/* ----------------------------------------------------------------------------------------- helpers */

const MAX_AUDIT_REASON = 500;

const rootTag = (rootId: Hex): string[] => ['e', rootId, '', 'root'];

/**
 * The `e` tags of an event, which must be exactly one `["e", <64 hex>, "", <marker>]` per marker in `markers` and
 * nothing else. Returns the ids by marker.
 */
function markedIds(tags: readonly string[][], markers: readonly string[]): Record<string, Hex> {
  const eTags = named(tags, 'e');
  if (eTags.length !== markers.length) {
    badTag(`expected exactly ${markers.length} "e" tag(s) marked ${markers.join(', ')}`);
  }
  const out: Record<string, Hex> = {};
  for (const tag of eTags) {
    const [, id, hint, marker] = tag;
    if (tag.length !== 4 || hint !== '' || marker === undefined || !markers.includes(marker)) {
      badTag(`an "e" tag must be ["e", <id>, "", ${markers.map((m) => `"${m}"`).join(' | ')}]`);
    }
    const name = marker as string;
    if (name in out) badTag(`two "e" tags are marked "${name}"`);
    if (!isHex64(id)) badTag(`the "${name}" id must be 64 lowercase hex characters`);
    out[name] = id as Hex;
  }
  return out;
}

/** A decimal tag value that is an integer of at least `min` (no sign, no leading zeros). */
function numberTag(tags: readonly string[][], name: string, min: number): number {
  const n = decimal(one(tags, name), name);
  if (n < min) badTag(`"${name}" must be at least ${min}`);
  return n;
}

/** Deck wire errors become `bad-content`; anything else (a caller's bad `deckSize`) is left to the framing. */
function wire<T>(f: () => T): T {
  try {
    return f();
  } catch (e) {
    let isWire = false;
    try {
      isWire = e instanceof DeckWireError;
    } catch {
      // not a wire error
    }
    if (isWire) return badContent((e as DeckWireError).message);
    throw e;
  }
}

/** Decoded shares, which must be strictly ascending by `pos` (so no position is repeated). */
function posShares(v: unknown, path: string): PosShare[] {
  const out = list(v, path).map((x) => wire(() => decodeShare(x)));
  for (let i = 1; i < out.length; i++) {
    if ((out[i] as PosShare).pos <= (out[i - 1] as PosShare).pos) {
      badContent(`${path}: positions must be strictly ascending`);
    }
  }
  return out;
}

const encodeShares = (shares: readonly PosShare[]) => shares.map(encodeShare);

function parsedOf(ev: { id: Hex; pubkey: Hex; created_at: number }): Parsed {
  return { id: ev.id, pubkey: ev.pubkey, createdAt: ev.created_at };
}

function template(
  kind: number,
  createdAt: number,
  tags: string[][],
  content: unknown,
  proto: Proto = '1',
): EventTemplate {
  return { kind, created_at: createdAt, tags: [...tags, ['proto', proto]], content: canonicalJson(content) };
}

/* -------------------------------------------------------------------------------------------- move */

/**
 * The Move event (kind 7452), unsigned. Tags are root, prev and seq (PROTOCOL §4.4), then the game's `proto`.
 * Reveals and shares are written in the order given; the parser requires them sorted by position.
 */
export function moveTemplate(m: MoveSpec, createdAt: number, proto: Proto = '1'): EventTemplate {
  const c = m.content;
  const content =
    c.type === 'shuffle'
      ? { deck: encodeDeck(c.deck), proof: encodeShuffleProof(c.proof), type: 'shuffle' }
      : {
          action: c.action,
          reveals: encodeShares(c.reveals),
          shares: encodeShares(c.shares),
          type: 'action',
        };
  return template(
    KIND.move,
    createdAt,
    [rootTag(m.rootId), ['e', m.prevId, '', 'prev'], ['seq', String(m.seq)]],
    content,
    proto,
  );
}

/**
 * Parse a Move event of a game at `proto`. `deckSize` is the module's deck size: it sizes the shuffle decoders,
 * and a shuffle step with any other number of cards is rejected. Returns decoded deck types, never wire strings.
 * It parses only: it does not verify the proof or the shares, and the `action` (any JSON object) is left to the
 * module.
 */
export function parseMove(ev: unknown, deckSize: number, proto: Proto = '1'): ParsedMove {
  return parseEvent(
    ev,
    KIND.move,
    (e) => {
      const ids = markedIds(e.tags, ['root', 'prev']);
      const seq = numberTag(e.tags, 'seq', 1);
      const raw = canonicalContent(e.content);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        badContent('content: expected an object');
      const type = (raw as Record<string, unknown>).type;
      let content: MoveContent;
      if (type === 'shuffle') {
        const c = record(raw, 'content', ['deck', 'proof', 'type']);
        content = {
          type: 'shuffle',
          deck: wire(() => decodeDeck(c.deck, deckSize)),
          proof: wire(() => decodeShuffleProof(c.proof, deckSize)),
        };
      } else if (type === 'action') {
        const c = record(raw, 'content', ['action', 'reveals', 'shares', 'type']);
        if (typeof c.action !== 'object' || c.action === null || Array.isArray(c.action)) {
          badContent('action: expected a JSON object');
        }
        content = {
          type: 'action',
          action: c.action,
          reveals: posShares(c.reveals, 'reveals'),
          shares: posShares(c.shares, 'shares'),
        };
      } else {
        return badContent('type must be "shuffle" or "action"');
      }
      if ((seq === 1) !== (ids.prev === ids.root)) {
        badTag('"prev" must be the root exactly when "seq" is 1');
      }
      return { ...parsedOf(e), rootId: ids.root as Hex, prevId: ids.prev as Hex, seq, content };
    },
    proto,
  );
}

/* ------------------------------------------------------------------------------------------ shares */

/**
 * The v1 Shares event (kind 7453), unsigned: decryption shares outside the move chain (PROTOCOL §4.5). Protocol 1
 * only; a v2 game's Shares events are `cardSharesTemplate` and `rollSharesTemplate`.
 */
export function sharesTemplate(s: SharesSpec, createdAt: number): EventTemplate {
  return template(KIND.shares, createdAt, [rootTag(s.rootId)], {
    shares: encodeShares(s.shares),
    type: 'shares',
  });
}

/**
 * Parse a v1 Shares event: the root tag only, and shares strictly ascending by position. Protocol 1 only; a v2
 * game parses with `parseSharesV2`.
 */
export function parseShares(ev: unknown): ParsedShares {
  return parseEvent(
    ev,
    KIND.shares,
    (e) => {
      const ids = markedIds(e.tags, ['root']);
      const c = record(canonicalContent(e.content), 'content', ['shares', 'type']);
      if (c.type !== 'shares') badContent('type must be "shares"');
      return { ...parsedOf(e), rootId: ids.root as Hex, shares: posShares(c.shares, 'shares') };
    },
    '1',
  );
}

/* ----------------------------------------------------------------------------------------- timeout */

/** The Timeout claim (kind 7454), unsigned: root, head and the stalled seat; content `{}` (PROTOCOL §4.6). */
export function timeoutTemplate(t: TimeoutSpec, createdAt: number, proto: Proto = '1'): EventTemplate {
  return template(
    KIND.timeout,
    createdAt,
    [rootTag(t.rootId), ['e', t.headId, '', 'head'], ['seat', String(t.seat)]],
    {},
    proto,
  );
}

/** Parse a Timeout claim. Whether the seat exists and the deadline has passed is for the session engine. */
export function parseTimeout(ev: unknown, proto: Proto = '1'): ParsedTimeout {
  return parseEvent(
    ev,
    KIND.timeout,
    (e) => {
      const ids = markedIds(e.tags, ['root', 'head']);
      const seat = numberTag(e.tags, 'seat', 0);
      record(canonicalContent(e.content), 'content', []);
      return { ...parsedOf(e), rootId: ids.root as Hex, headId: ids.head as Hex, seat };
    },
    proto,
  );
}

/* ------------------------------------------------------------------------------------------ resign */

/**
 * The Resign event (kind 7457), unsigned: root and head (PROTOCOL §4.9). The content is `{"type":"resign"}` in a
 * deckless game (D045) and `{"secret":"<scalar>","type":"resign"}`, carrying the seat's deck secret, in a game
 * with a deck (D052).
 */
export function resignTemplate(r: ResignSpec, createdAt: number, proto: Proto = '1'): EventTemplate {
  const secret = r.secret ?? null;
  return template(
    KIND.resign,
    createdAt,
    [rootTag(r.rootId), ['e', r.headId, '', 'head']],
    secret === null ? { type: 'resign' } : { secret: encodeScalar(secret), type: 'resign' },
    proto,
  );
}

/**
 * Parse a Resign event for a game with a deck (`deck` true) or without one. Exactly one content form is accepted
 * for each: with a deck the content must carry the seat's deck secret, a canonical base64url scalar below the group
 * order; without one it must not. Whether its signer holds a seat, whether the secret matches the seat's deck key
 * (`x·G = X_k`) and what the resign ends are for the session engine.
 */
export function parseResign(ev: unknown, deck: boolean, proto: Proto = '1'): ParsedResign {
  return parseEvent(
    ev,
    KIND.resign,
    (e) => {
      const ids = markedIds(e.tags, ['root', 'head']);
      const c = record(canonicalContent(e.content), 'content', deck ? ['secret', 'type'] : ['type']);
      if (c.type !== 'resign') badContent('type must be "resign"');
      let secret: bigint | null = null;
      if (deck) {
        if (typeof c.secret !== 'string') badContent('secret: expected a base64url scalar');
        try {
          secret = decodeScalar(c.secret as string);
        } catch {
          return badContent('secret: expected a canonical base64url scalar below the group order');
        }
      }
      return { ...parsedOf(e), rootId: ids.root as Hex, headId: ids.head as Hex, secret };
    },
    proto,
  );
}

/* ------------------------------------------------------------------------------------------ secret */

/** The Secret reveal (kind 7455), unsigned: the seat's deck secret as an encoded scalar (PROTOCOL §4.7). */
export function secretTemplate(s: SecretSpec, createdAt: number, proto: Proto = '1'): EventTemplate {
  return template(
    KIND.reveal,
    createdAt,
    [rootTag(s.rootId)],
    { deckSecret: encodeScalar(s.deckSecret) },
    proto,
  );
}

/** Parse a Secret reveal. The client still checks `x·G = X_k` against the seat's deck key. */
export function parseSecret(ev: unknown, proto: Proto = '1'): ParsedSecret {
  return parseEvent(
    ev,
    KIND.reveal,
    (e) => {
      const ids = markedIds(e.tags, ['root']);
      const c = record(canonicalContent(e.content), 'content', ['deckSecret']);
      const text = c.deckSecret;
      if (typeof text !== 'string') badContent('deckSecret: expected a base64url scalar');
      let deckSecret: bigint;
      try {
        deckSecret = decodeScalar(text as string);
      } catch {
        return badContent('deckSecret: expected a canonical base64url scalar below the group order');
      }
      return { ...parsedOf(e), rootId: ids.root as Hex, deckSecret };
    },
    proto,
  );
}

/* ------------------------------------------------------------------------------------------ attest */

/**
 * The Result attestation (kind 7456), unsigned (PROTOCOL §4.8). At proto `'2'` it is the stats attestation
 * (PROTOCOL-v2 §4.3, §7.4), whose `endedBy.type` may only be `'resign'`: an outcome ended by a `'fork'` (v1's frozen
 * ends, removed in v2) throws a `ProtocolError` (`bad-content`) rather than build an event every v2 client rejects.
 */
export function attestTemplate(a: AttestSpec, createdAt: number, proto: Proto = '1'): EventTemplate {
  if (proto !== '1' && a.outcome.endedBy !== undefined && a.outcome.endedBy.type !== 'resign')
    throw new ProtocolError(
      'bad-content',
      `a proto ${proto} stats attestation never carries endedBy "${a.outcome.endedBy.type}" (PROTOCOL-v2 §4.3)`,
    );
  return template(
    KIND.attest,
    createdAt,
    [rootTag(a.rootId)],
    {
      audit: a.audit,
      logHash: a.logHash,
      outcome: outcomeContent(a.outcome),
    },
    proto,
  );
}

/**
 * An outcome's attested JSON: `places`, `reason` and `scores`, plus `unrated` and `endedBy` only when present
 * (D052), so every result without them is attested byte for byte as before.
 */
function outcomeContent(o: Outcome): Record<string, unknown> {
  const out: Record<string, unknown> = { places: o.places, reason: o.reason, scores: o.scores };
  if (o.unrated !== undefined) out.unrated = o.unrated;
  if (o.endedBy !== undefined) out.endedBy = { seat: o.endedBy.seat, type: o.endedBy.type };
  return out;
}

function auditOf(v: unknown): Audit {
  if (v === 'pass') return 'pass';
  const a = record(v, 'audit', ['fail', 'reason']);
  const fail = list(a.fail, 'audit.fail');
  if (fail.length === 0) badContent('audit.fail: expected at least one seat');
  let last = -1;
  for (const [i, s] of fail.entries()) {
    if (typeof s !== 'number' || !Number.isSafeInteger(s) || s < 0) {
      return badContent(`audit.fail[${i}]: expected a seat number`);
    }
    if (s <= last) return badContent('audit.fail: seats must be strictly ascending');
    last = s;
  }
  const reason = a.reason;
  if (typeof reason !== 'string' || [...reason].length < 1 || [...reason].length > MAX_AUDIT_REASON) {
    badContent(`audit.reason: expected 1 to ${MAX_AUDIT_REASON} code points`);
  }
  return { fail: fail as number[], reason: reason as string };
}

/**
 * The optional outcome keys (D052) present in `v`, which must be an object: `unrated` and `endedBy` are accepted
 * only together, each in its one encoding.
 */
function extraKeys(v: unknown): string[] {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return [];
  const has = (k: string): boolean => Object.hasOwn(v, k);
  return has('unrated') || has('endedBy') ? ['endedBy', 'unrated'] : [];
}

function outcomeOf(v: unknown): Outcome {
  const extra = extraKeys(v);
  const o = record(v, 'outcome', ['places', 'reason', 'scores', ...extra]);
  const places = list(o.places, 'outcome.places');
  const scores = list(o.scores, 'outcome.scores');
  if (places.length !== scores.length) badContent('outcome: places and scores differ in length');
  places.forEach((p, i) => {
    if (typeof p !== 'number' || !Number.isSafeInteger(p) || p < 1) {
      badContent(`outcome.places[${i}]: expected an integer of at least 1`);
    }
  });
  scores.forEach((s, i) => {
    if (typeof s !== 'number' || !Number.isSafeInteger(s))
      badContent(`outcome.scores[${i}]: expected an integer`);
  });
  if (typeof o.reason !== 'string') badContent('outcome.reason: expected a string');
  const out: Outcome = { places: places as number[], reason: o.reason as string, scores: scores as number[] };
  if (extra.length === 0) return out;
  if (o.unrated !== true) badContent('outcome.unrated: expected true');
  const by = record(o.endedBy, 'outcome.endedBy', ['seat', 'type']);
  if (by.type !== 'resign' && by.type !== 'fork')
    badContent('outcome.endedBy.type: expected "resign" or "fork"');
  if (
    typeof by.seat !== 'number' ||
    !Number.isSafeInteger(by.seat) ||
    by.seat < 0 ||
    by.seat >= places.length
  )
    badContent('outcome.endedBy.seat: expected a seat number');
  return { ...out, unrated: true, endedBy: { type: by.type as EndedBy['type'], seat: by.seat as number } };
}

/**
 * Parse a v1 Result attestation: shapes only. Whether it matches the audit is for the client. Protocol 1 only; a
 * v2 game parses with `parseAttestV2`.
 */
export function parseAttest(ev: unknown): ParsedAttest {
  return parseEvent(
    ev,
    KIND.attest,
    (e) => {
      const ids = markedIds(e.tags, ['root']);
      const c = record(canonicalContent(e.content), 'content', ['audit', 'logHash', 'outcome']);
      return {
        ...parsedOf(e),
        rootId: ids.root as Hex,
        audit: auditOf(c.audit),
        logHash: hex64(c.logHash, 'logHash'),
        outcome: outcomeOf(c.outcome),
      };
    },
    '1',
  );
}

/* -------------------------------------------------------------------------------------- v2 shares */

/** A protocol 2 card Shares event (PROTOCOL-v2 §4.2): prompt releases and the deal, anchored on the head. */
export interface CardSharesSpec {
  rootId: Hex;
  /** The releaser's head when it built the event: the last move on its walk, or the root id. */
  anchorId: Hex;
  /** One or more shares, by global deck position (a packet position with a partitioned deck). */
  shares: PosShare[];
}

/** A protocol 2 roll Shares event (PROTOCOL-v2 §4.2, §6.2): dice contributions to one requesting move. */
export interface RollSharesSpec {
  rootId: Hex;
  anchorId: Hex;
  /** The requesting move: the Move whose game action requested the rolls. */
  moveId: Hex;
  /** One or more contributions; here `pos` is the roll index n within the requesting move. */
  shares: PosShare[];
}

export type ParsedCardShares = Parsed & CardSharesSpec & { type: 'shares' };
export type ParsedRollShares = Parsed & RollSharesSpec & { type: 'roll' };

const anchorTag = (anchorId: Hex): string[] => ['e', anchorId, '', 'anchor'];

/** The card variant of a v2 Shares event (kind 7453), unsigned: root and anchor tags, `["proto","2"]`. */
export function cardSharesTemplate(s: CardSharesSpec, createdAt: number): EventTemplate {
  return template(
    KIND.shares,
    createdAt,
    [rootTag(s.rootId), anchorTag(s.anchorId)],
    { shares: encodeShares(s.shares), type: 'shares' },
    '2',
  );
}

/** The roll variant of a v2 Shares event (kind 7453), unsigned: root and anchor tags, `["proto","2"]`. */
export function rollSharesTemplate(s: RollSharesSpec, createdAt: number): EventTemplate {
  return template(
    KIND.shares,
    createdAt,
    [rootTag(s.rootId), anchorTag(s.anchorId)],
    { move: s.moveId, shares: encodeShares(s.shares), type: 'roll' },
    '2',
  );
}

/**
 * Parse a v2 Shares event (PROTOCOL-v2 §4.2): `["proto","2"]`, exactly one `root` and one `anchor` `e` tag, and a
 * `type` of `"shares"` (keys `shares`, `type`) or `"roll"` (keys `move`, `shares`, `type`), with one or more
 * shares strictly ascending by `pos`. Whether the game has a deck or rolls, and every proof, are for the session.
 */
export function parseSharesV2(ev: unknown): ParsedCardShares | ParsedRollShares {
  return parseEvent(
    ev,
    KIND.shares,
    (e) => {
      const ids = markedIds(e.tags, ['root', 'anchor']);
      const raw = canonicalContent(e.content);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        badContent('content: expected an object');
      const type = (raw as Record<string, unknown>).type;
      const head = { ...parsedOf(e), rootId: ids.root as Hex, anchorId: ids.anchor as Hex };
      if (type === 'shares') {
        const c = record(raw, 'content', ['shares', 'type']);
        return { ...head, type: 'shares' as const, shares: someShares(c.shares) };
      }
      if (type === 'roll') {
        const c = record(raw, 'content', ['move', 'shares', 'type']);
        const moveId = hex64(c.move, 'move');
        return { ...head, type: 'roll' as const, moveId, shares: someShares(c.shares) };
      }
      return badContent('type must be "shares" or "roll"');
    },
    '2',
  );
}

/** One or more shares, strictly ascending by `pos`. */
function someShares(v: unknown): PosShare[] {
  const shares = posShares(v, 'shares');
  if (shares.length === 0) badContent('shares: expected at least one share');
  return shares;
}

/* -------------------------------------------------------------------------------------- v2 attest */

export type EndKind = 'over' | 'claim' | 'resign';

/** A result's identity as an end attestation names it (PROTOCOL-v2 §4.3, §5.3), with the line's log hash. */
export interface EndResult {
  kind: EndKind;
  /** The forfeiting seats, strictly ascending: none for `over`, the resigner for `resign`, one or more for `claim`. */
  forfeit: number[];
  /** `logHash` of the chain's move ids from move 1 to the head. */
  logHash: Hex;
}

/** An end attestation (PROTOCOL-v2 §4.3): signed by the seat's session key or its npub. */
export interface EndAttestSpec {
  rootId: Hex;
  /** The result's head (PROTOCOL-v2 §5.3). */
  headId: Hex;
  end: EndResult;
}

export type ParsedEndAttest = Parsed & EndAttestSpec & { variant: 'end' };
/** A v2 stats attestation (PROTOCOL-v2 §4.3, §7.4): the v1 content, `endedBy.type` `'resign'` only. */
export type ParsedStatsAttest = Parsed & AttestSpec & { variant: 'stats' };

const END_KINDS: readonly string[] = ['over', 'claim', 'resign'];

/** The end attestation (kind 7456), unsigned: root and head tags, `["proto","2"]`, content `{"end": …}`. */
export function endAttestTemplate(a: EndAttestSpec, createdAt: number): EventTemplate {
  const { end } = a;
  return template(
    KIND.attest,
    createdAt,
    [rootTag(a.rootId), ['e', a.headId, '', 'head']],
    { end: { forfeit: end.forfeit, kind: end.kind, logHash: end.logHash } },
    '2',
  );
}

function endOf(v: unknown): EndResult {
  const o = record(v, 'end', ['forfeit', 'kind', 'logHash']);
  const kind = o.kind;
  if (typeof kind !== 'string' || !END_KINDS.includes(kind))
    badContent('end.kind: expected "over", "claim" or "resign"');
  const forfeit = list(o.forfeit, 'end.forfeit');
  let last = -1;
  for (const [i, s] of forfeit.entries()) {
    if (typeof s !== 'number' || !Number.isSafeInteger(s) || s < 0)
      return badContent(`end.forfeit[${i}]: expected a seat number`);
    if (s <= last) return badContent('end.forfeit: seats must be strictly ascending');
    last = s;
  }
  if (kind === 'over' && forfeit.length !== 0) badContent('end.forfeit: expected no seat for "over"');
  if (kind === 'resign' && forfeit.length !== 1)
    badContent('end.forfeit: expected exactly one seat for "resign"');
  if (kind === 'claim' && forfeit.length === 0)
    badContent('end.forfeit: expected at least one seat for "claim"');
  return { kind: kind as EndKind, forfeit: forfeit as number[], logHash: hex64(o.logHash, 'end.logHash') };
}

/**
 * Parse a v2 Result attestation (PROTOCOL-v2 §4.3), whose content key set selects the variant: exactly `{end}` is
 * an end attestation, with exactly a `root` and a `head` `e` tag; exactly `{audit, logHash, outcome}` is a stats
 * attestation, with exactly a `root` `e` tag, whose `endedBy.type` may not be `"fork"`. Anything else is
 * rejected. Signer-agnostic: which key may sign each variant (session key or npub) is for the session.
 */
export function parseAttestV2(ev: unknown): ParsedEndAttest | ParsedStatsAttest {
  return parseEvent(
    ev,
    KIND.attest,
    (e) => {
      const raw = canonicalContent(e.content);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
        badContent('content: expected an object');
      // Compare the key list itself, not a joined string (a key may contain a comma).
      const keys = Object.keys(raw as object).sort();
      const is = (want: readonly string[]): boolean =>
        keys.length === want.length && want.every((k, i) => keys[i] === k);
      if (is(['end'])) {
        const ids = markedIds(e.tags, ['root', 'head']);
        const end = endOf((raw as Record<string, unknown>).end);
        return {
          ...parsedOf(e),
          variant: 'end' as const,
          rootId: ids.root as Hex,
          headId: ids.head as Hex,
          end,
        };
      }
      if (is(['audit', 'logHash', 'outcome'])) {
        const ids = markedIds(e.tags, ['root']);
        const c = raw as Record<string, unknown>;
        const outcome = outcomeOf(c.outcome);
        if (outcome.endedBy !== undefined && outcome.endedBy.type !== 'resign')
          badContent('outcome.endedBy.type: expected "resign"');
        return {
          ...parsedOf(e),
          variant: 'stats' as const,
          rootId: ids.root as Hex,
          audit: auditOf(c.audit),
          logHash: hex64(c.logHash, 'logHash'),
          outcome,
        };
      }
      return badContent('content: expected exactly the key end, or exactly the keys audit, logHash, outcome');
    },
    '2',
  );
}

/* ------------------------------------------------------------------------------------- device note */

/** A Device note (PROTOCOL-v2 §4.4): hands a seat's play to another device, in an audit-`'none'` game. */
export interface DeviceNoteSpec {
  rootId: Hex;
  /** The new playing device's id: 16 random bytes as 32 lowercase hex characters. */
  device: string;
  /** The note's number, at least 1. */
  n: number;
}

export type ParsedDeviceNote = Parsed & DeviceNoteSpec;

const DEVICE_ID = /^[0-9a-f]{32}$/;

/** The Device note (kind 7458), unsigned: the root tag, `["proto","2"]`, content `{device, n, type}`. */
export function deviceNoteTemplate(d: DeviceNoteSpec, createdAt: number): EventTemplate {
  return template(
    KIND.device,
    createdAt,
    [rootTag(d.rootId)],
    { device: d.device, n: d.n, type: 'device' },
    '2',
  );
}

/**
 * Parse a Device note (PROTOCOL-v2 §4.4): `["proto","2"]`, exactly one `root` `e` tag, `device` 32 lowercase hex
 * characters and `n` an integer of at least 1 (canonical JSON, so without leading zeros).
 */
export function parseDeviceNote(ev: unknown): ParsedDeviceNote {
  return parseEvent(
    ev,
    KIND.device,
    (e) => {
      const ids = markedIds(e.tags, ['root']);
      const c = record(canonicalContent(e.content), 'content', ['device', 'n', 'type']);
      if (c.type !== 'device') badContent('type must be "device"');
      if (typeof c.device !== 'string' || !DEVICE_ID.test(c.device))
        badContent('device: expected 32 lowercase hex characters');
      if (typeof c.n !== 'number' || !Number.isSafeInteger(c.n) || c.n < 1)
        badContent('n: expected an integer of at least 1');
      return { ...parsedOf(e), rootId: ids.root as Hex, device: c.device as string, n: c.n as number };
    },
    '2',
  );
}

/* --------------------------------------------------------------------------------------- log hash */

/** The hex SHA-256 of the UTF-8 of the move event ids in `seq` order joined with `\n` (PROTOCOL §4.8). */
export function logHash(moveIds: readonly Hex[]): Hex {
  return bytesToHex(sha256(utf8ToBytes(moveIds.join('\n'))));
}
