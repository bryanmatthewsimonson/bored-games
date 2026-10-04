/**
 * pnpm --filter @bored-games/client vectors
 *
 * Writes `test/vectors/dice-v2.json`, PROTOCOL-v2 §12.2 item 7 for Bank 0.2.0: a seeded 3-seat protocol 2 game
 * played by real `GameSessionV2`s, up to its first roll.
 * - `move`: the roller's Roll, the requesting move M. It requests one roll, (M, 0), of two six-sided dice.
 * - `contributions`: each seat's roll Shares event (built by its `roll` duty, anchored on M), with its `D`.
 * - `seed` and `faces`: the SHA-256 of the three `D` points in seat order (33 compressed bytes each), and
 *   `faces(seed, 2, 6)`; `rolled`, the derived action as the fold logs it.
 * - `orders`: the contributions delivered in every order (six), each step's receive status and waiting seats, from a
 *   spectator that holds the root and M. The roll is derived when the last one arrives, whoever it is, the
 *   requester included (`requesterLast`).
 * - `twoDevices`: a second device of seat `secondDevice.seat` publishes its own contribution to (M, 0): the same `D`
 *   with another proof. Delivered after that seat's first one it is a `duplicate`, and nothing else changes: Shares
 *   events are not moves, so it is never a fork.
 * - `rival` (T10): the roller signs a second Roll on M's prev, the root: a fork at the root, signed by the roller.
 *   The game stops there (PROTOCOL-v2 §5.6): not cancelled (both Rolls are valid game actions at or past P), P
 *   before play (every other seat shares first place, the roller last, every score 0). Its `orders` deliver M, the
 *   rival and the three contributions to M in several orders to a spectator; each ends at the same stop, with no
 *   duty for any seat and nobody stalled, and each contribution to M is `stored` once the fork is held (M is off
 *   the walk) or `accepted` before.
 *
 * Every signed event is in the file (the table, the Joins, the root, M and the Shares events), with the seats'
 * secrets: these are test vectors, and an implementation outside this repository reproduces them from the file.
 * `test/v2/dice.test.ts` checks that regenerating gives the file byte for byte and folds the file's events.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bank } from '@bored-games/bank';
import { encodePoint, G, moveRollPoint, rollSeed, type Share } from '@bored-games/deck';
import { faces } from '@bored-games/dice';
import { canonicalJson } from '@bored-games/game-kit';
import { finalizeEvent, type Hex, moveTemplate, type NostrEvent, parseSharesV2 } from '@bored-games/protocol';
import type { LoggedAction } from '../src/audit.ts';
import type { Duty, Identity, ReceiveResult } from '../src/types.ts';
import { GameSessionV2 } from '../src/v2/session.ts';
import { makeModuleGame, NOW, ROOT_SEEN, type TestGame } from '../test/helpers.ts';

export const DICE_SEED = 'dice-v2';

export interface DiceStep {
  seat: number;
  /** Which device of the seat signed it: 1 for the first, 2 for the second (`twoDevices` only). */
  device: 1 | 2;
  status: ReceiveResult['status'];
  /** The seats the spectator waits on after the step (`waitingFor`). */
  waiting: number[];
}

export interface DiceVectors {
  version: 2;
  seed: string;
  game: string;
  engine: string;
  seats: number;
  identities: { seat: number; sessionSk: Hex; deckSecret: string; deckKey: string }[];
  table: NostrEvent;
  joins: NostrEvent[];
  root: NostrEvent;
  /** The requesting move M: the roller's Roll. */
  move: NostrEvent;
  requester: number;
  roll: { id: number; n: number; count: number; sides: number; point: string };
  contributions: { seat: number; D: string; event: NostrEvent }[];
  rollSeed: Hex;
  faces: number[];
  rolled: LoggedAction;
  orders: { order: number[]; requesterLast: boolean; steps: DiceStep[] }[];
  secondDevice: { seat: number; D: string; event: NostrEvent };
  twoDevices: { steps: DiceStep[] };
  /** The rival Roll: a fork at the root, the roller's stop (T10). */
  rival: {
    event: NostrEvent;
    orders: {
      /** The events delivered, in order: `M`, `rival`, or a contribution's seat. */
      order: (number | 'M' | 'rival')[];
      statuses: ReceiveResult['status'][];
      fork: { at: Hex; seat: number; certificate: Hex[] } | null;
      stop: { at: Hex; seat: number; cancelled: boolean } | null;
      equivocators: number[];
      outcome: unknown;
      phase: string;
      waiting: number[];
    }[];
    /** Each seat's duties once it holds every event: none. */
    duties: Duty[][];
  };
}

const hex = (b: Uint8Array): Hex => Buffer.from(b).toString('hex');

/** Every order of `xs`, in lexicographic order of indices. */
export function permutations<T>(xs: readonly T[]): T[][] {
  if (xs.length <= 1) return [[...xs]];
  const out: T[][] = [];
  for (const [i, x] of xs.entries())
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) out.push([x, ...rest]);
  return out;
}

export function diceSession(game: TestGame, me: Identity | null): GameSessionV2 {
  return GameSessionV2.create({
    modules: game.modules,
    table: game.table,
    joins: game.joins,
    root: game.root,
    me,
    rootSeenAt: ROOT_SEEN,
  });
}

/** The action log of `s`'s walk (test access to the session's fold). */
export function actionLog(s: GameSessionV2): readonly LoggedAction[] {
  return (s as unknown as { current: { line: { log: readonly LoggedAction[] } } }).current.line.log;
}

export function generateDiceVectors(): DiceVectors {
  const game = makeModuleGame(bank, 3, DICE_SEED, bank.defaultRules(), '2');
  const ids = game.ids as Identity[];
  const players = ids.map((id) => diceSession(game, id));
  const requester = players.findIndex((s) => s.duties().some((d) => d.kind === 'decide'));
  const roller = players[requester] as GameSessionV2;
  const roll = roller.legalActions().find((a) => (a as { type: string }).type === 'roll');
  const move = roller.buildAction(roll, game.rnd, NOW);
  for (const s of players) s.receive(move, NOW);
  // Every seat contributes once M is on its chain; the requester too, after its own move.
  const contribution = (s: GameSessionV2): NostrEvent => {
    const d = s.duties().find((x): x is Extract<Duty, { kind: 'roll' }> => x.kind === 'roll');
    if (d === undefined || d.move !== move.id) throw new Error('no roll duty for M');
    return s.buildRoll(move.id, game.rnd, NOW);
  };
  const events = players.map(contribution);
  const dOf = (ev: NostrEvent): string => encodePoint(parseSharesV2(ev).shares[0]?.share.D ?? G);
  const twin = (requester + 1) % 3;
  const second = diceSession(game, ids[twin] as Identity);
  second.receive(move, NOW);
  const secondEvent = contribution(second);

  const fresh = (): GameSessionV2 => {
    const s = diceSession(game, null);
    s.receive(move, NOW);
    return s;
  };
  const deliver = (s: GameSessionV2, seat: number, device: 1 | 2, ev: NostrEvent): DiceStep => ({
    seat,
    device,
    status: s.receive(ev, NOW).status,
    waiting: s.waitingFor(),
  });
  const orders = permutations([0, 1, 2]).map((order) => {
    const s = fresh();
    const steps = order.map((seat) => deliver(s, seat, 1, events[seat] as NostrEvent));
    return { order, requesterLast: order[2] === requester, steps };
  });
  const s = fresh();
  const steps: DiceStep[] = [];
  for (const seat of [0, 1, 2]) {
    steps.push(deliver(s, seat, 1, events[seat] as NostrEvent));
    if (seat === twin) steps.push(deliver(s, seat, 2, secondEvent));
  }
  const seed = rollSeed(events.map((ev) => parseSharesV2(ev).shares[0]?.share as Share));
  // The seats fold the contributions too: `rolled` is the derived action as a seat's fold logs it.
  for (const p of players) for (const ev of events) p.receive(ev, NOW);
  const logged = actionLog(players[0] as GameSessionV2).find((x) => x.actor === 'beacon');
  if (logged === undefined) throw new Error('the roll was not derived');
  // The rival Roll, made last so that every value above keeps its bytes: the roller's second move 1 on the root.
  const rivalEvent = finalizeEvent(
    moveTemplate(
      {
        rootId: game.rootId,
        prevId: game.rootId,
        seq: 1,
        content: { type: 'action', action: roll, reveals: [], shares: [] },
      },
      NOW + 1,
      '2',
    ),
    (ids[requester] as Identity).sessionSk,
    game.rnd,
  );
  const rivalOrders = (
    [
      ['M', 0, 1, 2, 'rival'],
      ['M', 'rival', 0, 1, 2],
      ['rival', 2, 'M', 1, 0],
      [1, 'rival', 0, 'M', 2],
    ] as (number | 'M' | 'rival')[][]
  ).map((order) => {
    const spectator = diceSession(game, null);
    const statuses = order.map(
      (x) =>
        spectator.receive(x === 'M' ? move : x === 'rival' ? rivalEvent : (events[x] as NostrEvent), NOW)
          .status,
    );
    const v = spectator.view();
    return {
      order,
      statuses,
      fork: v.fork,
      stop: v.stop,
      equivocators: v.equivocators,
      outcome: v.outcome,
      phase: v.phase,
      waiting: spectator.waitingFor(),
    };
  });
  for (const p of players) p.receive(rivalEvent, NOW);
  return {
    version: 2,
    seed: DICE_SEED,
    game: bank.id,
    engine: bank.version,
    seats: 3,
    identities: ids.map((id) => ({
      seat: id.seat,
      sessionSk: hex(id.sessionSk),
      deckSecret: id.deckSecret.toString(16),
      deckKey: encodePoint(G.multiply(id.deckSecret)),
    })),
    table: game.table,
    joins: [...game.joins],
    root: game.root,
    move,
    requester,
    roll: { id: 0, n: 0, count: 2, sides: 6, point: encodePoint(moveRollPoint(game.rootId, move.id, 0)) },
    contributions: events.map((event, seat) => ({ seat, D: dOf(event), event })),
    rollSeed: hex(seed),
    faces: faces(seed, 2, 6),
    rolled: logged,
    orders,
    secondDevice: { seat: twin, D: dOf(secondEvent), event: secondEvent },
    twoDevices: { steps },
    rival: { event: rivalEvent, orders: rivalOrders, duties: players.map((p) => p.duties()) },
  };
}

/** The file's bytes: canonical JSON, one trailing newline. */
export function diceFile(): string {
  return `${canonicalJson(generateDiceVectors())}\n`;
}

const FILE = new URL('../test/vectors/dice-v2.json', import.meta.url);

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  mkdirSync(new URL('.', FILE), { recursive: true });
  writeFileSync(FILE, diceFile());
  console.log(`wrote ${fileURLToPath(FILE)}`);
}
