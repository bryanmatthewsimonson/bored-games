import { G, type Point, type RandomBytes, randomScalar } from '@bored-games/deck';
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
   * The valid Joins that hold a seat: the creator's, then invited npubs that joined (in invited-list order), then
   * other joiners by `created_at` and id, capped at the table's open seats. One per npub, the earliest.
   */
  joins: ParsedJoin[];
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

/**
 * Fold the lobby events seen for one table. `tableEv` is the latest version of the Table; `events` may hold
 * anything: Joins and roots for this table count, everything else (unparseable events, other tables, Joins
 * committed to other rules or another version, bad proofs of knowledge) is ignored. Order and duplicates do not
 * matter. Throws `ClientError` only if `tableEv` itself is not a valid Table.
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

  // Valid Joins, one per npub: the earliest, then the lowest id.
  const candidates: { join: ParsedJoin; created_at: number }[] = [];
  const parsedRoots: { root: ParsedRoot; created_at: number }[] = [];
  for (const ev of events) {
    const kind = (ev as { kind?: unknown } | null)?.kind;
    if (kind === KIND.join) {
      const join = tryParse(parseJoin, ev);
      if (join === null) continue;
      if (join.tableAddress !== table.address) continue;
      if (join.rulesHash !== hash || join.version !== table.version) continue;
      if (join.session === join.npub) continue;
      if (join.deckKey.toHex(true).slice(2) === join.session) continue;
      if (!verifyJoin(join)) continue;
      candidates.push({ join, created_at: ev.created_at });
    } else if (kind === KIND.root) {
      const root = tryParse(parseRoot, ev);
      if (root !== null && root.tableAddress === table.address)
        parsedRoots.push({ root, created_at: ev.created_at });
    }
  }

  const earliest = new Map<Hex, { join: ParsedJoin; created_at: number }>();
  for (const c of candidates) {
    const held = earliest.get(c.join.npub);
    if (
      held === undefined ||
      byTimeThenId(
        { created_at: c.created_at, id: c.join.id },
        { created_at: held.created_at, id: held.join.id },
      ) < 0
    )
      earliest.set(c.join.npub, c);
  }
  const valid = [...earliest.values()].sort((a, b) =>
    byTimeThenId({ created_at: a.created_at, id: a.join.id }, { created_at: b.created_at, id: b.join.id }),
  );

  // Seats: the creator, the invited in list order, then other joiners in time order, capped at `open`.
  const byNpub = new Map(valid.map((c) => [c.join.npub, c.join]));
  const ordered: ParsedJoin[] = [];
  const creatorJoin = byNpub.get(table.creator);
  if (creatorJoin !== undefined) ordered.push(creatorJoin);
  for (const p of table.invited) {
    const j = byNpub.get(p);
    if (j !== undefined) ordered.push(j);
  }
  const others = valid
    .map((c) => c.join)
    .filter((j) => j.npub !== table.creator && !table.invited.includes(j.npub));

  const seated: ParsedJoin[] = [];
  const npubs = new Set<string>();
  const sessions = new Set<string>();
  const deckKeys = new Set<string>();
  const seatIn = (j: ParsedJoin): boolean => {
    const dk = j.deckKey.toHex(true);
    if (sessions.has(j.session) || deckKeys.has(dk) || npubs.has(j.session) || sessions.has(j.npub))
      return false;
    seated.push(j);
    npubs.add(j.npub);
    sessions.add(j.session);
    deckKeys.add(dk);
    return true;
  };
  for (const j of ordered) seatIn(j);
  let openTaken = 0;
  for (const j of others) {
    if (openTaken >= table.open) break;
    if (seatIn(j)) openTaken++;
  }

  const full =
    creatorJoin !== undefined &&
    seated.includes(creatorJoin) &&
    table.invited.every((p) => seated.some((j) => j.npub === p)) &&
    openTaken === table.open;

  const joinsById = new Map<Hex, ParsedJoin>(valid.map((c) => [c.join.id, c.join]));
  const root =
    parsedRoots
      .sort((a, b) =>
        byTimeThenId(
          { created_at: a.created_at, id: a.root.id },
          { created_at: b.created_at, id: b.root.id },
        ),
      )
      .find((r) => validateRoot(r.root, table, joinsById, modules).length === 0)?.root ?? null;

  return { table, joins: seated, seatsFilled: seated.length, full, root };
}

/** The seats in root order: the creator first, then the rest in `foldLobby` order. */
export function rootSeatOrder(view: LobbyView): ParsedJoin[] {
  const { creator } = view.table;
  return [...view.joins.filter((j) => j.npub === creator), ...view.joins.filter((j) => j.npub !== creator)];
}

/**
 * The unsigned Join for `table`, claiming a seat for `npub` with these keys. The npub's signer signs it, outside
 * this package. It commits to the table's rules hash and version (PROTOCOL §4.2).
 */
export function buildJoinTemplate(
  table: ParsedTable,
  npub: Hex,
  keys: GameKeys,
  relays: readonly string[],
  rnd: RandomBytes,
  createdAt: number,
): EventTemplate {
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
    },
    createdAt,
  );
}

/** The unsigned root for a full lobby, for the table creator to sign. Throws `ClientError` unless `view.full`. */
export function buildRootTemplate(
  view: LobbyView,
  relays: readonly string[],
  createdAt: number,
): EventTemplate {
  if (!view.full) throw new ClientError('the lobby is not full');
  return rootTemplate(
    { table: view.table, joins: rootSeatOrder(view), rules: view.table.rules, relays: [...relays] },
    createdAt,
  );
}
