import {
  decodePoint,
  decodePok,
  encodePoint,
  encodePok,
  jointKey,
  type Point,
  type PokProof,
  provePok,
  type RandomBytes,
  verifyPok,
} from '@bored-games/deck';
import { canonicalJson, type GameModule, moduleFor, moduleProtocols } from '@bored-games/game-kit';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { ProtocolError } from './errors.ts';
import { DEADLINES, KIND, MAX_EVENT_BYTES, type Proto } from './kinds.ts';
import { type EventTemplate, eventBytes, type Hex, isHex64, type NostrEvent, verifyEvent } from './nostr.ts';
import { many, named, one, requireProto } from './tags.ts';

/*
 * Lobby events (PROTOCOL §4.1–§4.3): Table, Join and Game root. Templates build unsigned events; parsers take
 * signed events from peers and accept exactly one shape, throwing `ProtocolError` on anything else. Every
 * parser checks, in order: the size cap, NIP-01 validity, the kind, the `proto` tag, the required tags, that
 * the content is canonical JSON, and the content's exact shape.
 */

/* --------------------------------------------------------------------------------------------- types */

export type TableStatus = 'open' | 'started' | 'cancelled';

export interface TableSpec {
  /** The `d` tag: 1–64 characters of `[A-Za-z0-9._-]`. */
  tableId: string;
  game: string;
  version: string;
  seats: number;
  deadline: number;
  invited: Hex[];
  open: number;
  relays: string[];
  status: TableStatus;
  rules: unknown;
  /** The game's protocol version, the `proto` tag (PROTOCOL-v2 §2). The template's default is `'1'`. */
  proto?: Proto | undefined;
}

export type ParsedTable = TableSpec & { creator: Hex; address: string; proto: Proto };

export interface JoinSpec {
  tableAddress: string;
  creator: Hex;
  deckKey: Point;
  pok: PokProof;
  relays: string[];
  session: Hex;
  /**
   * The session key's proof of possession: a BIP-340 signature by the session secret key over
   * `sessionMessage(tableAddress, npub)`, as 128 lowercase hex characters (PROTOCOL §4.2, D033). `signSession`
   * makes it.
   */
  sessionSig: Hex;
  /** `rulesHash(table.rules)`: commits the Join to the table's rules (PROTOCOL §4.2). */
  rulesHash: Hex;
  /** The table's engine version, the `v` tag. */
  version: string;
  /** The table's protocol version, the `proto` tag (PROTOCOL-v2 §2). The template's default is `'1'`. */
  proto?: Proto | undefined;
}

export type ParsedJoin = JoinSpec & { id: Hex; npub: Hex; proto: Proto };

export interface RootSeat {
  deckKey: Point;
  npub: Hex;
  session: Hex;
}

export interface RootSpec {
  table: ParsedTable;
  /** In seat order. */
  joins: ParsedJoin[];
  rules: unknown;
  relays: string[];
  /**
   * The game's protocol version, the `proto` tag (PROTOCOL-v2 §2): the root MUST carry its table's. The template
   * uses `table.proto` when this is absent, and `'1'` when both are.
   */
  proto?: Proto | undefined;
}

export interface ParsedRoot {
  id: Hex;
  creator: Hex;
  tableAddress: string;
  game: string;
  version: string;
  deadline: number;
  rulesHash: Hex;
  /** The Join event id of each seat, in seat order. */
  joinIds: Hex[];
  relays: string[];
  rules: unknown;
  seats: RootSeat[];
  /** The game's protocol version (PROTOCOL-v2 §2). */
  proto: Proto;
}

/* ----------------------------------------------------------------------------------- field checks */

const TABLE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const ADDRESS = /^37450:([0-9a-f]{64}):([A-Za-z0-9._-]{1,64})$/;
const DECIMAL = /^(0|[1-9][0-9]*)$/;
const MAX_SEATS = 64;
// Host: a DNS-ish name (no leading `-`), an IPv4 address or a bracketed IPv6 address. Then an optional port and
// an optional path, query or fragment of printable ASCII. No userinfo.
const RELAY =
  /^wss?:\/\/(\[[0-9a-fA-F:]+\]|[A-Za-z0-9.][A-Za-z0-9.-]*)(?::([0-9]{1,5}))?([/?#][\x21-\x7e]*)?$/;
const IPV4_LIKE = /^[0-9.]+$/;
const MAX_RELAY_LENGTH = 256;
const MAX_NAME_LENGTH = 64;
const STATUSES: readonly string[] = ['open', 'started', 'cancelled'];

/**
 * A `ws://` or `wss://` URL of at most 256 characters: a host (a DNS-style name, an IPv4 address or a bracketed
 * IPv6 address), an optional port of 1–5 digits up to 65535, and an optional path, query or fragment of
 * printable ASCII. Userinfo is rejected. A manual check: the `URL` global is outside the pure packages' lib.
 */
export function isRelayUrl(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > MAX_RELAY_LENGTH) return false;
  const m = RELAY.exec(s);
  if (m === null) return false;
  const host = m[1] as string;
  if (host.startsWith('[')) {
    if (!host.includes(':')) return false;
  } else if (IPV4_LIKE.test(host)) {
    const parts = host.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^[0-9]{1,3}$/.test(p) || Number(p) > 255)) return false;
  }
  return m[2] === undefined || Number(m[2]) <= 65535;
}

/** The NIP-01 address of a Table event: `37450:<creator hex>:<tableId>`. */
export function tableAddress(creator: Hex, tableId: string): string {
  return `${KIND.table}:${creator}:${tableId}`;
}

export const badTag = (message: string): never => {
  throw new ProtocolError('bad-tag', message);
};

export const badContent = (message: string): never => {
  throw new ProtocolError('bad-content', message);
};

export function decimal(s: string, name: string): number {
  const n = Number(s);
  if (!DECIMAL.test(s) || !Number.isSafeInteger(n)) badTag(`"${name}" must be a decimal integer`);
  return n;
}

function deadlineOf(s: string): number {
  const n = decimal(s, 'deadline');
  if (!(DEADLINES as readonly number[]).includes(n))
    badTag(`deadline ${n} is not one of ${DEADLINES.join(', ')}`);
  return n;
}

function shortText(s: string, name: string): string {
  if (s.length === 0 || s.length > MAX_NAME_LENGTH)
    badTag(`"${name}" must have 1 to ${MAX_NAME_LENGTH} characters`);
  return s;
}

function addressOf(s: string): { creator: Hex; tableId: string } {
  const m = ADDRESS.exec(s);
  if (m === null) return badTag('"a" must be a table address 37450:<creator hex>:<table id>');
  return { creator: m[1] as Hex, tableId: m[2] as string };
}

function relayTags(tags: readonly string[][]): string[] {
  const relays = many(tags, 'relay');
  if (relays.length === 0) badTag('expected at least one "relay" tag');
  for (const r of relays)
    if (!isRelayUrl(r)) badTag(`"relay" ${JSON.stringify(r)} is not a ws:// or wss:// URL`);
  if (new Set(relays).size !== relays.length) badTag('a "relay" URL is listed twice');
  return relays;
}

/** The parsed content, which must be canonical JSON (PROTOCOL §2). */
export function canonicalContent(content: string): unknown {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return badContent('content is not JSON');
  }
  let canonical: string;
  try {
    canonical = canonicalJson(value);
  } catch {
    return badContent('content is not canonical JSON');
  }
  if (canonical !== content) badContent('content is not canonical JSON');
  return value;
}

/** A JSON object with exactly `keys`. */
export function record(v: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    return badContent(`${path}: expected an object`);
  const own = Object.keys(v).sort();
  const want = [...keys].sort();
  if (own.length !== want.length || own.some((k, i) => k !== want[i])) {
    badContent(`${path}: expected exactly the keys ${want.join(', ')}`);
  }
  return v as Record<string, unknown>;
}

export function list(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) return badContent(`${path}: expected an array`);
  return v;
}

export function hex64(v: unknown, path: string): Hex {
  if (!isHex64(v)) return badContent(`${path}: expected 64 lowercase hex characters`);
  return v;
}

function point(v: unknown, path: string): Point {
  try {
    if (typeof v !== 'string') throw new TypeError('not a string');
    return decodePoint(v);
  } catch {
    return badContent(`${path}: expected a base64url curve point`);
  }
}

function pokOf(v: unknown, path: string): PokProof {
  try {
    return decodePok(v);
  } catch {
    return badContent(`${path}: expected {c, s} base64url scalars`);
  }
}

function relayList(v: unknown, path: string): string[] {
  const relays = list(v, path);
  if (relays.length === 0) badContent(`${path}: expected at least one relay`);
  for (const r of relays)
    if (!isRelayUrl(r)) badContent(`${path}: ${JSON.stringify(r)} is not a ws:// or wss:// URL`);
  if (new Set(relays).size !== relays.length) badContent(`${path}: a relay URL is listed twice`);
  return relays as string[];
}

/* --------------------------------------------------------------------------------- parse framing */

export function isProtocolError(e: unknown): e is ProtocolError {
  try {
    return e instanceof ProtocolError;
  } catch {
    return false;
  }
}

export function reason(e: unknown): string {
  try {
    if (e instanceof Error && typeof e.message === 'string') return e.message;
  } catch {
    // fall through
  }
  return 'invalid value';
}

/**
 * The size cap, then NIP-01 validity, the kind and the `proto` tag; then `body`, given the event's proto. Throws
 * only `ProtocolError`. `proto` is the game's expected proto (in-game events), or null for any accepted proto
 * (lobby events, which declare the game's proto). Required, so no in-game parser can forget it.
 */
export function parseEvent<T>(
  ev: unknown,
  kind: number,
  body: (ev: NostrEvent, proto: Proto) => T,
  proto: Proto | null,
): T {
  try {
    let size: number;
    try {
      size = eventBytes(ev as NostrEvent);
    } catch {
      throw new ProtocolError('invalid-event', 'not a serializable NOSTR event');
    }
    if (size > MAX_EVENT_BYTES)
      throw new ProtocolError('too-large', `event is ${size} bytes, over ${MAX_EVENT_BYTES}`);
    if (!verifyEvent(ev))
      throw new ProtocolError('invalid-event', 'not a valid NIP-01 event (shape, id or signature)');
    if (ev.kind !== kind) throw new ProtocolError('wrong-kind', `expected kind ${kind}, got ${ev.kind}`);
    const found = requireProto(ev.tags, proto ?? undefined);
    return body(ev, found);
  } catch (e) {
    if (isProtocolError(e)) throw e;
    throw new ProtocolError('malformed', reason(e));
  }
}

/* ------------------------------------------------------------------------------------------ table */

/** The Table event (kind 37450) for `spec`, unsigned. Content is `{"rules": …}`. */
export function tableTemplate(spec: TableSpec, createdAt: number): EventTemplate {
  return {
    kind: KIND.table,
    created_at: createdAt,
    tags: [
      ['d', spec.tableId],
      ['game', spec.game],
      ['v', spec.version],
      ['seats', String(spec.seats)],
      ['deadline', String(spec.deadline)],
      ...spec.invited.map((p) => ['p', p]),
      ['open', String(spec.open)],
      ...spec.relays.map((r) => ['relay', r]),
      ['status', spec.status],
      ['proto', spec.proto ?? '1'],
    ],
    content: canonicalJson({ rules: spec.rules }),
  };
}

/**
 * Parse a Table event (PROTOCOL §4.1). Checks that `seats ≥ 2`, that invited + open = seats − 1, that the deadline
 * is one of `DEADLINES`, that invited pubkeys are unique lowercase hex and not the creator, and that relays are
 * `ws://` or `wss://` URLs.
 */
export function parseTable(ev: unknown): ParsedTable {
  return parseEvent(
    ev,
    KIND.table,
    (e, proto) => {
      const tags = e.tags;
      const tableId = one(tags, 'd');
      if (!TABLE_ID.test(tableId)) badTag('"d" must be 1 to 64 characters of [A-Za-z0-9._-]');
      const game = shortText(one(tags, 'game'), 'game');
      const version = shortText(one(tags, 'v'), 'v');
      const seats = decimal(one(tags, 'seats'), 'seats');
      if (seats < 2) badTag('a table needs at least 2 seats');
      if (seats > MAX_SEATS) badTag(`a table has at most ${MAX_SEATS} seats`);
      const deadline = deadlineOf(one(tags, 'deadline'));
      const invited = many(tags, 'p');
      const seen = new Set<string>();
      for (const p of invited) {
        if (!isHex64(p)) badTag('"p" must be 64 lowercase hex characters');
        if (p === e.pubkey) badTag('the creator cannot invite itself');
        if (seen.has(p)) badTag('a pubkey is invited twice');
        seen.add(p);
      }
      const open = decimal(one(tags, 'open'), 'open');
      if (invited.length + open !== seats - 1) badTag('invited plus open seats must equal seats minus 1');
      const relays = relayTags(tags);
      const status = one(tags, 'status');
      if (!STATUSES.includes(status)) badTag(`"status" must be one of ${STATUSES.join(', ')}`);
      const content = record(canonicalContent(e.content), 'content', ['rules']);
      return {
        tableId,
        game,
        version,
        seats,
        deadline,
        invited,
        open,
        relays,
        status: status as TableStatus,
        rules: content.rules,
        creator: e.pubkey,
        address: tableAddress(e.pubkey, tableId),
        proto,
      };
    },
    null,
  );
}

/* ------------------------------------------------------------------------------------------- join */

/** The proof of knowledge of the deck key `x`, bound to `[tableAddress, npub, session]` (PROTOCOL §3). */
export function makeJoinPok(
  x: bigint,
  tableAddress: string,
  npub: Hex,
  session: Hex,
  rnd: RandomBytes,
): PokProof {
  return provePok(x, [tableAddress, npub, session], rnd);
}

const SESSION_TAG = 'bored-games/v1/session';
const HEX128 = /^[0-9a-f]{128}$/;

/**
 * The 32-byte message a session key signs to prove possession (PROTOCOL §4.2, D033):
 * `SHA-256(UTF-8("bored-games/v1/session\n" + tableAddress + "\n" + npub))`. It binds the session key to one npub at
 * one table, so another player cannot reuse it.
 */
export function sessionMessage(tableAddress: string, npub: Hex): Uint8Array {
  return sha256(utf8ToBytes(`${SESSION_TAG}\n${tableAddress}\n${npub}`));
}

/**
 * The Join's `sessionSig`: a BIP-340 signature by `sessionSk` over `sessionMessage(tableAddress, npub)`. The
 * auxiliary randomness is 32 bytes from `rnd`. Throws a `RangeError` when `rnd` returns the wrong length, and
 * whatever noble throws for an invalid secret key (caller errors).
 */
export function signSession(sessionSk: Uint8Array, tableAddress: string, npub: Hex, rnd: RandomBytes): Hex {
  const aux = rnd(32);
  if (aux.length !== 32) throw new RangeError('random source returned the wrong number of bytes');
  return bytesToHex(schnorr.sign(sessionMessage(tableAddress, npub), sessionSk, aux));
}

/** Whether `sig` is the session key's valid proof of possession for `npub` at `tableAddress`. Never throws. */
function verifySession(sig: Hex, session: Hex, tableAddress: string, npub: Hex): boolean {
  try {
    return schnorr.verify(hexToBytes(sig), sessionMessage(tableAddress, npub), hexToBytes(session));
  } catch {
    return false;
  }
}

/** The Join event (kind 7451) for `spec`, unsigned; the player's npub signs it. */
export function joinTemplate(spec: JoinSpec, createdAt: number): EventTemplate {
  return {
    kind: KIND.join,
    created_at: createdAt,
    tags: [
      ['a', spec.tableAddress],
      ['p', spec.creator],
      ['rules-hash', spec.rulesHash],
      ['v', spec.version],
      ['proto', spec.proto ?? '1'],
    ],
    content: canonicalJson({
      deckKey: encodePoint(spec.deckKey),
      pok: encodePok(spec.pok),
      relays: spec.relays,
      session: spec.session,
      sessionSig: spec.sessionSig,
    }),
  };
}

/**
 * Parse a Join event (PROTOCOL §4.2). The `p` tag must be the creator named in the `a` address. `npub` is the
 * event's pubkey. It verifies `sessionSig`, the session key's proof of possession bound to the table address and
 * the npub (D033); `verifyJoin` checks the deck key's proof of knowledge.
 */
export function parseJoin(ev: unknown): ParsedJoin {
  return parseEvent(
    ev,
    KIND.join,
    (e, proto) => {
      const address = one(e.tags, 'a');
      const { creator } = addressOf(address);
      if (one(e.tags, 'p') !== creator) badTag('"p" must be the creator named in the table address');
      const hash = one(e.tags, 'rules-hash');
      if (!isHex64(hash)) badTag('"rules-hash" must be 64 lowercase hex characters');
      const version = shortText(one(e.tags, 'v'), 'v');
      const c = record(canonicalContent(e.content), 'content', [
        'deckKey',
        'pok',
        'relays',
        'session',
        'sessionSig',
      ]);
      const deckKey = point(c.deckKey, 'deckKey');
      const pok = pokOf(c.pok, 'pok');
      const relays = relayList(c.relays, 'relays');
      const session = hex64(c.session, 'session');
      const sessionSig = c.sessionSig;
      if (typeof sessionSig !== 'string' || !HEX128.test(sessionSig))
        badContent('sessionSig: expected 128 lowercase hex characters');
      if (!verifySession(sessionSig as Hex, session, address, e.pubkey))
        badContent('sessionSig: not a signature by the session key over this table address and npub');
      return {
        id: e.id,
        npub: e.pubkey,
        tableAddress: address,
        creator,
        deckKey,
        pok,
        relays,
        session,
        sessionSig: sessionSig as Hex,
        rulesHash: hash,
        version,
        proto,
      };
    },
    null,
  );
}

/** The Join's proof of knowledge of its deck key, over `[tableAddress, npub, session]`. */
export function verifyJoin(
  join: Pick<ParsedJoin, 'deckKey' | 'pok' | 'tableAddress' | 'npub' | 'session'>,
): boolean {
  return verifyPok(join.deckKey, join.pok, [join.tableAddress, join.npub, join.session]);
}

/* ------------------------------------------------------------------------------------------- root */

/** The hex SHA-256 of the UTF-8 of `canonicalJson(rules)`. */
export function rulesHash(rules: unknown): Hex {
  return bytesToHex(sha256(utf8ToBytes(canonicalJson(rules))));
}

/**
 * The Game root event (kind 7450), unsigned; the table creator signs it. Tags follow PROTOCOL §4.3: one
 * `["e", joinId, relay, "seat:<i>"]` per seat in seat order, where relay is the Join's first relay.
 */
export function rootTemplate(spec: RootSpec, createdAt: number): EventTemplate {
  const { table, joins } = spec;
  return {
    kind: KIND.root,
    created_at: createdAt,
    tags: [
      ['a', table.address],
      ['game', table.game],
      ['v', table.version],
      ['deadline', String(table.deadline)],
      ['rules-hash', rulesHash(spec.rules)],
      ...joins.map((j, i) => ['e', j.id, j.relays[0] ?? '', `seat:${i}`]),
      ...spec.relays.map((r) => ['relay', r]),
      ['proto', spec.proto ?? table.proto ?? '1'],
    ],
    content: canonicalJson({
      rules: spec.rules,
      seats: joins.map((j) => ({ deckKey: encodePoint(j.deckKey), npub: j.npub, session: j.session })),
    }),
  };
}

/**
 * Parse a Game root event (PROTOCOL §4.3). The `e` tags must be exactly `["e", joinId, relay | "", "seat:<i>"]`
 * for i = 0, 1, … with distinct ids, one per content seat. It checks shapes only; `validateRoot` checks the root
 * against its table and Joins.
 */
export function parseRoot(ev: unknown): ParsedRoot {
  return parseEvent(
    ev,
    KIND.root,
    (e, proto) => {
      const tags = e.tags;
      const address = one(tags, 'a');
      addressOf(address);
      const game = shortText(one(tags, 'game'), 'game');
      const version = shortText(one(tags, 'v'), 'v');
      const deadline = deadlineOf(one(tags, 'deadline'));
      const hash = one(tags, 'rules-hash');
      if (!isHex64(hash)) badTag('"rules-hash" must be 64 lowercase hex characters');
      const eTags = named(tags, 'e');
      if (eTags.length === 0) badTag('expected one "e" tag per seat');
      const joinIds: Hex[] = [];
      eTags.forEach((tag, i) => {
        const [, id, relay, marker] = tag;
        if (tag.length !== 4 || !isHex64(id) || marker !== `seat:${i}`) {
          badTag(`"e" tag ${i} must be ["e", <join id>, <relay>, "seat:${i}"]`);
        }
        if (relay !== '' && !isRelayUrl(relay)) badTag(`"e" tag ${i} has a bad relay hint`);
        if (joinIds.includes(id as Hex)) badTag(`join ${id} is listed twice`);
        joinIds.push(id as Hex);
      });
      const relays = relayTags(tags);
      const c = record(canonicalContent(e.content), 'content', ['rules', 'seats']);
      const rawSeats = list(c.seats, 'seats');
      if (rawSeats.length !== joinIds.length)
        badContent(`${rawSeats.length} seats but ${joinIds.length} "e" tags`);
      const seats = rawSeats.map((s, i): RootSeat => {
        const seat = record(s, `seats[${i}]`, ['deckKey', 'npub', 'session']);
        return {
          deckKey: point(seat.deckKey, `seats[${i}].deckKey`),
          npub: hex64(seat.npub, `seats[${i}].npub`),
          session: hex64(seat.session, `seats[${i}].session`),
        };
      });
      return {
        id: e.id,
        creator: e.pubkey,
        tableAddress: address,
        game,
        version,
        deadline,
        rulesHash: hash,
        joinIds,
        relays,
        rules: c.rules,
        seats,
        proto,
      };
    },
    null,
  );
}

/**
 * Every reason no module in `modules` can play `table` (PROTOCOL-v2 §2 item 6, §10), as short sentences; empty means
 * playable: a module for its (game, version) (`moduleFor`), which supports its proto, accepts its rules, and seats
 * its seat count. A client lists or joins only such a table. Never throws.
 */
export function validateTable(
  table: ParsedTable,
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>>,
): string[] {
  const problems: string[] = [];
  try {
    const proto = table.proto ?? '1';
    const module = moduleFor(modules, table.game, table.version);
    if (module === undefined) return [`there is no module for game ${table.game} ${table.version}`];
    if (!moduleProtocols(module).includes(Number(proto) as 1 | 2))
      problems.push(`${table.game} ${table.version} does not support proto ${proto}`);
    const rules = module.validateRules(table.rules);
    if (!rules.ok) problems.push(`rules rejected by the module: ${rules.error.message}`);
    else {
      const { min, max } = module.seatRange(rules.value);
      if (table.seats < min || table.seats > max)
        problems.push(`${table.seats} seats are outside the module's seat range ${min} to ${max}`);
    }
  } catch (e) {
    problems.push(`the table could not be validated: ${reason(e)}`);
  }
  return problems;
}

/**
 * Every reason `root` is not a valid start of the game at `table` (PROTOCOL §4.3), as short sentences; empty
 * means valid. `joinsById` holds the parsed Joins the client has seen; `modules` the rules modules by id, older
 * versions kept under `id@version` (`moduleFor`). The root, its table and every seat's Join must carry one proto,
 * and the module version must support it (PROTOCOL-v2 §2 items 2 and 6); an object without `proto` is proto 1.
 * Never throws.
 */
export function validateRoot(
  root: ParsedRoot,
  table: ParsedTable,
  joinsById: ReadonlyMap<Hex, ParsedJoin>,
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>>,
): string[] {
  const problems: string[] = [];
  const add = (p: string) => void problems.push(p);
  try {
    if (root.creator !== table.creator) add('the root is not signed by the table creator');
    if (root.tableAddress !== table.address) add('the root names another table address');
    if (root.game !== table.game) add(`game ${root.game} differs from the table's ${table.game}`);
    if (root.version !== table.version)
      add(`version ${root.version} differs from the table's ${table.version}`);
    if (root.deadline !== table.deadline)
      add(`deadline ${root.deadline} differs from the table's ${table.deadline}`);
    const proto = table.proto ?? '1';
    if ((root.proto ?? '1') !== proto) add(`proto ${root.proto} differs from the table's ${proto}`);

    const n = root.seats.length;
    if (n !== table.seats) add(`the root has ${n} seats but the table has ${table.seats}`);
    if (root.joinIds.length !== n) add(`the root lists ${root.joinIds.length} joins for ${n} seats`);

    for (const [i, seat] of root.seats.entries()) {
      const id = root.joinIds[i] as Hex;
      const join = joinsById.get(id);
      if (join === undefined || join === null) {
        add(`seat ${i}: unknown join ${id}`);
        continue;
      }
      try {
        if (join.id !== id) add(`seat ${i}: the join map holds another event under ${id}`);
        if (join.tableAddress !== table.address) add(`seat ${i}: the join is for another table`);
        if (join.npub !== seat.npub) add(`seat ${i}: the npub differs from its join`);
        if (join.session !== seat.session) add(`seat ${i}: the session differs from its join`);
        if (join.rulesHash !== root.rulesHash) add(`seat ${i}: the join committed to other rules`);
        if (join.version !== root.version) add(`seat ${i}: the join committed to version ${join.version}`);
        if ((join.proto ?? '1') !== proto) add(`seat ${i}: the join is for proto ${join.proto}`);
        if (!join.deckKey.equals(seat.deckKey)) add(`seat ${i}: the deck key differs from its join`);
        if (!verifyJoin(join)) add(`seat ${i}: the join's proof of knowledge does not verify`);
      } catch {
        add(`seat ${i}: the join is malformed`);
      }
    }

    const repeated: [string, (s: RootSeat) => string][] = [
      ['npub', (s) => s.npub],
      ['session', (s) => s.session],
      ['deck key', (s) => s.deckKey.toHex(true)],
    ];
    for (const [what, field] of repeated) {
      const seen = new Set<string>();
      for (const v of root.seats.map(field)) {
        if (seen.has(v)) add(`${what} ${v} is used more than once`);
        seen.add(v);
      }
    }

    const npubs = new Set(root.seats.map((s) => s.npub));
    for (const [i, seat] of root.seats.entries()) {
      if (bytesToHex(seat.deckKey.toBytes(true).slice(1)) === seat.session) {
        add(`seat ${i}: the deck key's x-coordinate equals its session key`);
      }
      if (npubs.has(seat.session)) add(`seat ${i}: the session key is a seat's npub`);
    }

    if (!root.seats.some((s) => s.npub === table.creator)) add('the table creator does not hold a seat');
    const uninvited = root.seats.filter(
      (s) => s.npub !== table.creator && !table.invited.includes(s.npub),
    ).length;
    if (uninvited > table.open) {
      add(`${uninvited} seated npubs are not invited, more than the table's ${table.open} open seats`);
    }

    if (rulesHash(root.rules) !== root.rulesHash) add('the rules-hash tag does not match the rules');
    if (rulesHash(root.rules) !== rulesHash(table.rules)) add("the rules differ from the table's rules");

    if (n > 0 && jointKey(root.seats.map((s) => s.deckKey)).is0()) add('the joint key is the identity');

    const module = moduleFor(modules, root.game, root.version) ?? modules.get(root.game);
    if (module === undefined) {
      add(`there is no module for game ${root.game}`);
    } else {
      if (module.version !== root.version)
        add(`version ${root.version} is not the module's version ${module.version}`);
      else if (!moduleProtocols(module).includes(Number(proto) as 1 | 2))
        add(`${root.game} ${root.version} does not support proto ${proto}`);
      const rules = module.validateRules(root.rules);
      if (!rules.ok) {
        add(`rules rejected by the module: ${rules.error.message}`);
      } else {
        const { min, max } = module.seatRange(rules.value);
        if (n < min || n > max) add(`${n} seats are outside the module's seat range ${min} to ${max}`);
      }
    }
  } catch (e) {
    add(`the root could not be validated: ${reason(e)}`);
  }
  return problems;
}
