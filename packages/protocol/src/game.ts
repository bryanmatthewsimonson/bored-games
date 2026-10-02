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
import { KIND, PROTO } from './kinds.ts';
import { badContent, badTag, canonicalContent, decimal, hex64, list, parseEvent, record } from './lobby.ts';
import { type EventTemplate, type Hex, isHex64 } from './nostr.ts';
import { named, one } from './tags.ts';

/*
 * In-game events (PROTOCOL §4.4–§4.9): Move, Shares, Timeout claim, Secret reveal, Result attestation and Resign.
 * Templates build unsigned events; parsers take signed events from peers, run the same pipeline as the lobby
 * parsers (size cap, NIP-01 validity, kind, `proto` tag, required tags, canonical content, exact content shape)
 * and throw `ProtocolError` on anything else. Parsers check shapes only: proofs, owed shares, the `x·G = X_k`
 * check and the move's meaning belong to the session engine.
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

/** Who ended a game outside its rules (PROTOCOL §7, §8.3, D052): for now only a Resign in a game of 3+ seats. */
export interface EndedBy {
  type: 'resign';
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

function template(kind: number, createdAt: number, tags: string[][], content: unknown): EventTemplate {
  return { kind, created_at: createdAt, tags: [...tags, ['proto', PROTO]], content: canonicalJson(content) };
}

/* -------------------------------------------------------------------------------------------- move */

/**
 * The Move event (kind 7452), unsigned. Tags are root, prev and seq (PROTOCOL §4.4). Reveals and shares are
 * written in the order given; the parser requires them sorted by position.
 */
export function moveTemplate(m: MoveSpec, createdAt: number): EventTemplate {
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
  );
}

/**
 * Parse a Move event. `deckSize` is the module's deck size: it sizes the shuffle decoders, and a shuffle step
 * with any other number of cards is rejected. Returns decoded deck types, never wire strings. It parses only:
 * it does not verify the proof or the shares, and the `action` (any JSON object) is left to the module.
 */
export function parseMove(ev: unknown, deckSize: number): ParsedMove {
  return parseEvent(ev, KIND.move, (e) => {
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
  });
}

/* ------------------------------------------------------------------------------------------ shares */

/** The Shares event (kind 7453), unsigned: decryption shares outside the move chain (PROTOCOL §4.5). */
export function sharesTemplate(s: SharesSpec, createdAt: number): EventTemplate {
  return template(KIND.shares, createdAt, [rootTag(s.rootId)], {
    shares: encodeShares(s.shares),
    type: 'shares',
  });
}

/** Parse a Shares event: the root tag only, and shares strictly ascending by position. */
export function parseShares(ev: unknown): ParsedShares {
  return parseEvent(ev, KIND.shares, (e) => {
    const ids = markedIds(e.tags, ['root']);
    const c = record(canonicalContent(e.content), 'content', ['shares', 'type']);
    if (c.type !== 'shares') badContent('type must be "shares"');
    return { ...parsedOf(e), rootId: ids.root as Hex, shares: posShares(c.shares, 'shares') };
  });
}

/* ----------------------------------------------------------------------------------------- timeout */

/** The Timeout claim (kind 7454), unsigned: root, head and the stalled seat; content `{}` (PROTOCOL §4.6). */
export function timeoutTemplate(t: TimeoutSpec, createdAt: number): EventTemplate {
  return template(
    KIND.timeout,
    createdAt,
    [rootTag(t.rootId), ['e', t.headId, '', 'head'], ['seat', String(t.seat)]],
    {},
  );
}

/** Parse a Timeout claim. Whether the seat exists and the deadline has passed is for the session engine. */
export function parseTimeout(ev: unknown): ParsedTimeout {
  return parseEvent(ev, KIND.timeout, (e) => {
    const ids = markedIds(e.tags, ['root', 'head']);
    const seat = numberTag(e.tags, 'seat', 0);
    record(canonicalContent(e.content), 'content', []);
    return { ...parsedOf(e), rootId: ids.root as Hex, headId: ids.head as Hex, seat };
  });
}

/* ------------------------------------------------------------------------------------------ resign */

/**
 * The Resign event (kind 7457), unsigned: root and head (PROTOCOL §4.9). The content is `{"type":"resign"}` in a
 * deckless game (D045) and `{"secret":"<scalar>","type":"resign"}`, carrying the seat's deck secret, in a game
 * with a deck (D052).
 */
export function resignTemplate(r: ResignSpec, createdAt: number): EventTemplate {
  const secret = r.secret ?? null;
  return template(
    KIND.resign,
    createdAt,
    [rootTag(r.rootId), ['e', r.headId, '', 'head']],
    secret === null ? { type: 'resign' } : { secret: encodeScalar(secret), type: 'resign' },
  );
}

/**
 * Parse a Resign event for a game with a deck (`deck` true) or without one. Exactly one content form is accepted
 * for each: with a deck the content must carry the seat's deck secret, a canonical base64url scalar below the group
 * order; without one it must not. Whether its signer holds a seat, whether the secret matches the seat's deck key
 * (`x·G = X_k`) and what the resign ends are for the session engine.
 */
export function parseResign(ev: unknown, deck: boolean): ParsedResign {
  return parseEvent(ev, KIND.resign, (e) => {
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
  });
}

/* ------------------------------------------------------------------------------------------ secret */

/** The Secret reveal (kind 7455), unsigned: the seat's deck secret as an encoded scalar (PROTOCOL §4.7). */
export function secretTemplate(s: SecretSpec, createdAt: number): EventTemplate {
  return template(KIND.reveal, createdAt, [rootTag(s.rootId)], { deckSecret: encodeScalar(s.deckSecret) });
}

/** Parse a Secret reveal. The client still checks `x·G = X_k` against the seat's deck key. */
export function parseSecret(ev: unknown): ParsedSecret {
  return parseEvent(ev, KIND.reveal, (e) => {
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
  });
}

/* ------------------------------------------------------------------------------------------ attest */

/** The Result attestation (kind 7456), unsigned (PROTOCOL §4.8). */
export function attestTemplate(a: AttestSpec, createdAt: number): EventTemplate {
  return template(KIND.attest, createdAt, [rootTag(a.rootId)], {
    audit: a.audit,
    logHash: a.logHash,
    outcome: outcomeContent(a.outcome),
  });
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
  if (by.type !== 'resign') badContent('outcome.endedBy.type: expected "resign"');
  if (
    typeof by.seat !== 'number' ||
    !Number.isSafeInteger(by.seat) ||
    by.seat < 0 ||
    by.seat >= places.length
  )
    badContent('outcome.endedBy.seat: expected a seat number');
  return { ...out, unrated: true, endedBy: { type: 'resign', seat: by.seat as number } };
}

/** Parse a Result attestation: shapes only. Whether it matches the audit is for the client. */
export function parseAttest(ev: unknown): ParsedAttest {
  return parseEvent(ev, KIND.attest, (e) => {
    const ids = markedIds(e.tags, ['root']);
    const c = record(canonicalContent(e.content), 'content', ['audit', 'logHash', 'outcome']);
    return {
      ...parsedOf(e),
      rootId: ids.root as Hex,
      audit: auditOf(c.audit),
      logHash: hex64(c.logHash, 'logHash'),
      outcome: outcomeOf(c.outcome),
    };
  });
}

/* --------------------------------------------------------------------------------------- log hash */

/** The hex SHA-256 of the UTF-8 of the move event ids in `seq` order joined with `\n` (PROTOCOL §4.8). */
export function logHash(moveIds: readonly Hex[]): Hex {
  return bytesToHex(sha256(utf8ToBytes(moveIds.join('\n'))));
}
