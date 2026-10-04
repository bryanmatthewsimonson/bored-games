import { G, jointKey, type Point, type RandomBytes, randomScalar } from '@bored-games/deck';
import type { GameModule } from '@bored-games/game-kit';
import {
  type EventTemplate,
  getPublicKey,
  type Hex,
  joinTemplate,
  KIND,
  makeJoinPok,
  type NostrEvent,
  type ParsedJoin,
  type ParsedRoot,
  type ParsedTable,
  parseJoin,
  parseRoot,
  parseTable,
  rootTemplate,
  rulesHash,
  signSession,
  validateRoot,
  verifyJoin,
} from '@bored-games/protocol';
import { ClientError } from './errors.ts';

/*
 * Lobby helpers (PROTOCOL §4.1–§4.3): fresh keys for a game, a fold of the lobby events seen for one table into
 * who holds the seats, and the unsigned Join and root events a client publishes. Pure: signing happens outside,
 * with the player's identity signer (NIP-07 or a local key).
 */

/** The secrets and public keys one player brings to one game. Use fresh keys for every game (PROTOCOL §3). */
export interface GameKeys {
  /** The session signing key; its x-only public key is the seat's `session`. */
  sessionSk: Uint8Array;
  sessionPub: Hex;
  /** The deck secret `x`, and its public deck key `X = x·G`. */
  deckSecret: bigint;
  deckKey: Point;
}

/** What the fold of a table's lobby events says. */
export interface LobbyView {
  table: ParsedTable;
  /**
   * The valid Joins that hold a seat, one per npub: the creator's, then invited npubs that joined (in invited-list
   * order), then other joiners in the order of their earliest valid Join (`created_at`, then id), capped at the
   * table's open seats. Each npub gets its first Join, in time order, that collides with no seat already taken.
   */
  joins: ParsedJoin[];
  /**
   * Every valid Join for this table, seated or not, in `created_at` then id order: the pool an explicit seat list
   * for `buildRootTemplate` picks from.
   */
  candidates: ParsedJoin[];
  seatsFilled: number;
  /** The creator, every invited npub and `open` uninvited joiners have all joined. */
  full: boolean;
  /** The first valid root: lowest `created_at`, then id. */
  root: ParsedRoot | null;
}

/** 32 big-endian bytes of a scalar. */
function scalarBytes(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/** Fresh session and deck keys for one game. */
export function newGameKeys(rnd: RandomBytes): GameKeys {
  const sessionSk = scalarBytes(randomScalar(rnd));
  const deckSecret = randomScalar(rnd);
  return { sessionSk, sessionPub: getPublicKey(sessionSk), deckSecret, deckKey: G.multiply(deckSecret) };
}

function tryParse<T>(parse: (ev: unknown) => T, ev: unknown): T | null {
  try {
    return parse(ev);
  } catch {
    return null;
  }
}

/** Order by `created_at`, then by lowest id. */
const byTimeThenId = (a: { created_at: number; id: Hex }, b: { created_at: number; id: Hex }): number =>
  a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The x-coordinate of a deck key as 64 lowercase hex characters, the form a session key would share. */
const deckX = (deckKey: Point): Hex => deckKey.toHex(true).slice(2);

/**
 * Seats Joins one at a time, refusing any that collides with a seat already taken: a repeated npub, session key or
 * deck key, a session key equal to a seated npub, or an npub equal to a seated session key.
 */
class Seating {
  readonly seated: ParsedJoin[] = [];
  private readonly npubs = new Set<string>();
  private readonly sessions = new Set<string>();
  private readonly deckKeys = new Set<string>();

  /** Seat `j` unless it collides; whether it was seated. */
  add(j: ParsedJoin): boolean {
    const dk = j.deckKey.toHex(true);
    if (
      this.npubs.has(j.npub) ||
      this.sessions.has(j.session) ||
      this.deckKeys.has(dk) ||
      this.npubs.has(j.session) ||
      this.sessions.has(j.npub)
    )
      return false;
    this.seated.push(j);
    this.npubs.add(j.npub);
    this.sessions.add(j.session);
    this.deckKeys.add(dk);
    return true;
  }
}

/**
 * Fold the lobby events seen for one table. `tableEv` is the latest version of the Table; `events` may hold
 * anything: Joins and roots for this table count, everything else (unparseable events and non-events, other
 * tables, Joins committed to other rules, another version or another proto (PROTOCOL-v2 §2), bad proofs of
 * knowledge, a session key equal to the Join's own npub or to its deck key's x-coordinate) is ignored. Order and duplicates do not matter: the result is
 * a function of the set of events. Throws `ClientError` only if `tableEv` itself is not a valid Table.
 *
 * Seating, in this order:
 * 1. Drop the Joins that collide with themselves (above).
 * 2. Group the rest by npub, each npub's Joins in `created_at` then id order. An npub's priority slot is the
 *    creator's, its invited-list position or, for an open seat, the time of its earliest Join.
 * 3. Walk the slots in priority order and seat each npub's first Join that collides with no seat already taken, so a
 *    player whose earlier Join collides can re-join with fresh keys. Open seats stop at `open`.
 *
 * `created_at` is self-declared, so the default order of the open seats is attacker-controllable: a joiner can
 * backdate a Join to jump the queue, though never past the creator or an invited player. The creator can pick the
 * seats explicitly with `buildRootTemplate` (D021).
 */
export function foldLobby(
  tableEv: NostrEvent,
  events: readonly NostrEvent[],
  // biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
  modules: ReadonlyMap<string, GameModule<any, any, any>>,
): LobbyView {
  const table = tryParse(parseTable, tableEv);
  if (table === null) throw new ClientError('the table event is not a valid Table');
  const hash = rulesHash(table.rules);

  const joins = new Map<Hex, { join: ParsedJoin; created_at: number }>();
  const roots = new Map<Hex, { root: ParsedRoot; created_at: number }>();
  for (const ev of events) {
    try {
      const kind = (ev as { kind?: unknown } | null)?.kind;
      if (kind === KIND.join) {
        const join = tryParse(parseJoin, ev);
        if (join === null || joins.has(join.id)) continue;
        if (join.tableAddress !== table.address) continue;
        if (join.rulesHash !== hash || join.version !== table.version) continue;
        if (join.proto !== table.proto) continue;
        if (join.session === join.npub || deckX(join.deckKey) === join.session) continue;
        if (!verifyJoin(join)) continue;
        joins.set(join.id, { join, created_at: ev.created_at });
      } else if (kind === KIND.root) {
        const root = tryParse(parseRoot, ev);
        if (root === null || root.tableAddress !== table.address || roots.has(root.id)) continue;
        roots.set(root.id, { root, created_at: ev.created_at });
      }
    } catch {
      // A hostile object whose fields throw: ignore it.
    }
  }

  const candidates = [...joins.values()]
    .sort((a, b) =>
      byTimeThenId({ created_at: a.created_at, id: a.join.id }, { created_at: b.created_at, id: b.join.id }),
    )
    .map((c) => c.join);

  // Each npub's Joins in time order. The map's key order is the order of each npub's earliest Join.
  const byNpub = new Map<Hex, ParsedJoin[]>();
  for (const j of candidates) {
    const list = byNpub.get(j.npub);
    if (list === undefined) byNpub.set(j.npub, [j]);
    else list.push(j);
  }

  const seating = new Seating();
  const seatNpub = (npub: Hex): boolean => (byNpub.get(npub) ?? []).some((j) => seating.add(j));
  const creatorSeated = seatNpub(table.creator);
  let invitedSeated = 0;
  for (const p of table.invited) if (seatNpub(p)) invitedSeated++;
  let openTaken = 0;
  for (const npub of byNpub.keys()) {
    if (openTaken >= table.open) break;
    if (npub === table.creator || table.invited.includes(npub)) continue;
    if (seatNpub(npub)) openTaken++;
  }
  const seated = seating.seated;
  const full = creatorSeated && invitedSeated === table.invited.length && openTaken === table.open;

  const joinsById = new Map<Hex, ParsedJoin>(candidates.map((j) => [j.id, j]));
  const root =
    [...roots.values()]
      .sort((a, b) =>
        byTimeThenId(
          { created_at: a.created_at, id: a.root.id },
          { created_at: b.created_at, id: b.root.id },
        ),
      )
      .find((r) => validateRoot(r.root, table, joinsById, modules).length === 0)?.root ?? null;

  return { table, joins: seated, candidates, seatsFilled: seated.length, full, root };
}

/** The seats in root order: the creator first, then the rest in `foldLobby` order. */
export function rootSeatOrder(view: LobbyView): ParsedJoin[] {
  const { creator } = view.table;
  return [...view.joins.filter((j) => j.npub === creator), ...view.joins.filter((j) => j.npub !== creator)];
}

/**
 * The unsigned Join for `table`, claiming a seat for `npub` with these keys. The npub's signer signs it, outside
 * this package. It commits to the table's rules hash and version (PROTOCOL §4.2), carries the table's proto
 * (PROTOCOL-v2 §2) and the session key's proof of possession (D033). Throws `ClientError` when `keys.sessionPub`
 * is not the public key of `keys.sessionSk`, or when the session key equals `npub` or the deck key's
 * x-coordinate, since peers drop such a Join.
 */
export function buildJoinTemplate(
  table: ParsedTable,
  npub: Hex,
  keys: GameKeys,
  relays: readonly string[],
  rnd: RandomBytes,
  createdAt: number,
): EventTemplate {
  let derived: Hex | null;
  try {
    derived = getPublicKey(keys.sessionSk);
  } catch {
    derived = null;
  }
  if (derived === null || derived !== keys.sessionPub)
    throw new ClientError('the session public key is not the public key of the session secret key');
  if (keys.sessionPub === npub) throw new ClientError('the session key must differ from the npub');
  if (deckX(keys.deckKey) === keys.sessionPub)
    throw new ClientError("the session key must differ from the deck key's x-coordinate");
  return joinTemplate(
    {
      tableAddress: table.address,
      creator: table.creator,
      deckKey: keys.deckKey,
      pok: makeJoinPok(keys.deckSecret, table.address, npub, keys.sessionPub, rnd),
      relays: [...relays],
      session: keys.sessionPub,
      sessionSig: signSession(keys.sessionSk, table.address, npub, rnd),
      rulesHash: rulesHash(table.rules),
      version: table.version,
      proto: table.proto,
    },
    createdAt,
  );
}

/**
 * The Joins of an explicit seat list, or why it cannot start the game at `view.table`: the checks of `validateRoot`
 * (PROTOCOL §4.3) that depend on the choice of seats. Every id names a Join of `view.candidates`, listed once, one
 * per seat; the creator's Join comes first; every invited npub and at most `open` others are seated; no npub,
 * session key or deck key repeats and no session key is a seat's npub; the joint key is not the identity.
 */
function explicitSeats(view: LobbyView, ids: readonly Hex[]): { joins: ParsedJoin[]; problems: string[] } {
  const { table } = view;
  const problems: string[] = [];
  const known = new Map(view.candidates.map((j) => [j.id, j]));
  if (ids.length !== table.seats)
    problems.push(`${ids.length} seats listed but the table has ${table.seats}`);
  const joins: ParsedJoin[] = [];
  for (const [i, id] of ids.entries()) {
    const j = known.get(id);
    if (j === undefined) problems.push(`seat ${i}: ${String(id)} is not a valid Join for this table`);
    else if (joins.includes(j)) problems.push(`seat ${i}: join ${id} is listed twice`);
    else joins.push(j);
  }
  if (problems.length > 0) return { joins, problems };
  if (joins[0]?.npub !== table.creator) problems.push("the creator's Join must hold seat 0");
  for (const p of table.invited)
    if (!joins.some((j) => j.npub === p)) problems.push(`invited npub ${p} holds no seat`);
  const uninvited = joins.filter((j) => j.npub !== table.creator && !table.invited.includes(j.npub)).length;
  if (uninvited > table.open)
    problems.push(
      `${uninvited} seated npubs are not invited, more than the table's ${table.open} open seats`,
    );
  const seating = new Seating();
  for (const [i, j] of joins.entries())
    if (!seating.add(j))
      problems.push(`seat ${i}: its npub, session key or deck key collides with another seat`);
  if (jointKey(joins.map((j) => j.deckKey)).is0()) problems.push('the joint key is the identity');
  return { joins, problems };
}

/**
 * The unsigned root for the lobby, for the table creator to sign. By default the seats are `rootSeatOrder(view)`,
 * and it throws `ClientError` unless `view.full`. `seats`, the Join ids in seat order, lets the creator choose among
 * the open joiners instead (D021). It throws `ClientError` unless that list passes the seat checks of
 * `validateRoot`: the creator first, every invited npub present, the open count respected and no collisions.
 */
export function buildRootTemplate(
  view: LobbyView,
  relays: readonly string[],
  createdAt: number,
  seats?: readonly Hex[],
): EventTemplate {
  let joins: ParsedJoin[];
  if (seats === undefined) {
    if (!view.full) throw new ClientError('the lobby is not full');
    joins = rootSeatOrder(view);
  } else {
    const picked = explicitSeats(view, seats);
    if (picked.problems.length > 0) throw new ClientError(`invalid seat list: ${picked.problems.join('; ')}`);
    joins = picked.joins;
  }
  return rootTemplate(
    { table: view.table, joins, rules: view.table.rules, relays: [...relays], proto: view.table.proto },
    createdAt,
  );
}
