import { chainReaction } from '@bored-games/chain-reaction';
import { G, type RandomBytes, randomScalar } from '@bored-games/deck';
import { createRng, type GameModule } from '@bored-games/game-kit';
import {
  finalizeEvent,
  getPublicKey,
  type Hex,
  joinTemplate,
  makeJoinPok,
  type NostrEvent,
  parseJoin,
  parseTable,
  rootTemplate,
  rulesHash,
  signSession,
  tableTemplate,
} from '@bored-games/protocol';
import { GameSession } from '../src/session.ts';
import type { Identity, ReceiveResult } from '../src/types.ts';

/** Deterministic byte source for tests, built on game-kit's seeded PRNG. */
export function seededRandom(seed: string): RandomBytes {
  const rng = createRng(seed);
  return (n) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = rng.int(256);
    return out;
  };
}

/** A valid 32-byte secret key: a nonzero scalar below the group order, big-endian. */
function secretKey(rnd: RandomBytes): Uint8Array {
  return Uint8Array.from(Buffer.from(randomScalar(rnd).toString(16).padStart(64, '0'), 'hex'));
}

export const T0 = 1_700_000_000;
/** A local clock reading well after every test event. */
export const NOW = T0 + 100_000;
export const RELAYS = ['wss://relay.example.com'];

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
export const MODULES: ReadonlyMap<string, GameModule<any, any, any>> = new Map([
  [chainReaction.id, chainReaction],
]);

export interface TestGame {
  modules: typeof MODULES;
  table: NostrEvent;
  joins: NostrEvent[];
  root: NostrEvent;
  rootId: Hex;
  /** Each seat's session identity, in seat order. */
  ids: Identity[];
  /** Each seat's npub secret key, distinct from its session key. */
  npubSks: Uint8Array[];
  /** The seed's byte source, for building further events. */
  rnd: RandomBytes;
}

/**
 * A Chain Reaction game of `seats` seats, ready to start: the Table by seat 0, one Join per seat committing to the
 * table's rules hash and version, and the root. Every key comes from `seededRandom(seed)`; events are dated from
 * `T0` on.
 */
export function makeGame(seats: number, seed: string): TestGame {
  const rnd = seededRandom(seed);
  const npubSks = Array.from({ length: seats }, () => secretKey(rnd));
  const ids: Identity[] = Array.from({ length: seats }, (_, seat) => ({
    seat,
    sessionSk: secretKey(rnd),
    deckSecret: randomScalar(rnd),
  }));
  const npubs = npubSks.map(getPublicKey);
  const rules = chainReaction.defaultRules();
  const table = finalizeEvent(
    tableTemplate(
      {
        tableId: 'test-table',
        game: chainReaction.id,
        version: chainReaction.version,
        seats,
        deadline: 259200,
        invited: npubs.slice(1),
        open: 0,
        relays: RELAYS,
        status: 'open',
        rules,
      },
      T0,
    ),
    npubSks[0] as Uint8Array,
    rnd,
  );
  const parsedTable = parseTable(table);
  const joins = ids.map((id, seat) => {
    const npub = npubs[seat] as Hex;
    const session = getPublicKey(id.sessionSk);
    const t = joinTemplate(
      {
        tableAddress: parsedTable.address,
        creator: parsedTable.creator,
        deckKey: G.multiply(id.deckSecret),
        pok: makeJoinPok(id.deckSecret, parsedTable.address, npub, session, rnd),
        relays: RELAYS,
        session,
        sessionSig: signSession(id.sessionSk, parsedTable.address, npub, rnd),
        rulesHash: rulesHash(rules),
        version: chainReaction.version,
      },
      T0 + 1 + seat,
    );
    return finalizeEvent(t, npubSks[seat] as Uint8Array, rnd);
  });
  const root = finalizeEvent(
    rootTemplate({ table: parsedTable, joins: joins.map(parseJoin), rules, relays: RELAYS }, T0 + 10),
    npubSks[0] as Uint8Array,
    rnd,
  );
  return { modules: MODULES, table, joins, root, rootId: root.id, ids, npubSks, rnd };
}

/** A session of `game` for `seat`, or a spectator for null. */
export function newSession(game: TestGame, seat: number | null): GameSession {
  return GameSession.create({
    modules: game.modules,
    table: game.table,
    joins: game.joins,
    root: game.root,
    me: seat === null ? null : (game.ids[seat] as Identity),
  });
}

/**
 * Deliver `events` to every session, in `order` (indices into `events`; all of them in turn by default).
 * Returns each delivery's result: `results[i][j]` is session `j`'s answer to the `i`-th delivery.
 */
export function deliver(
  sessions: readonly GameSession[],
  events: readonly unknown[],
  order: readonly number[] = events.map((_, i) => i),
  now: number = NOW,
): ReceiveResult[][] {
  return order.map((i) => sessions.map((s) => s.receive(events[i], now)));
}

/** Every delivery's status, flattened. */
export const statuses = (results: ReceiveResult[][]): string[] => results.flat().map((r) => r.status);

/**
 * Run the shuffle phase: each seat's session builds its step in turn, and every step goes to `players` and
 * `others`. `players[k]` must be seat k's session. Returns the steps in seq order.
 */
export function playShuffle(
  game: TestGame,
  players: readonly GameSession[],
  others: readonly GameSession[] = [],
  createdAt = T0 + 100,
): NostrEvent[] {
  const steps: NostrEvent[] = [];
  for (const [k, s] of players.entries()) {
    const ev = s.buildShuffle(game.rnd, createdAt + k);
    deliver([...players, ...others], [ev]);
    steps.push(ev);
  }
  return steps;
}
