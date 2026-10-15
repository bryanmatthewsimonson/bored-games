// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats and steps.

import { chainReaction } from '@bored-games/chain-reaction';
import { createRng, type Rng, range } from '@bored-games/game-kit';
import { holler } from '@bored-games/holler';
import {
  finalizeEvent,
  type Hex,
  KIND,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
  parseShares,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { deliver, makeGame, makeModuleGame, NOW, newSession, T0, type TestGame, trust } from './helpers.ts';

/*
 * Fork choice after an honest setup race in an any-order game (D093, Task 5b). The race leaves the losing setup
 * steps pooled beside the chain for the rest of the game. Their side branches hold setup steps only, so no share can
 * change their rank, and fork choice must not re-try them for every later event.
 */

const SEATS = 3;
const DECK = 108;
const ANY = { shuffleOrder: 'any' } as const;
const LONG = 600_000;

/** A session's fork trial counter (`sideBest` and `throughBest` runs without a kept verdict). */
const trials = (s: GameSession): number => (s as unknown as { trials: number }).trials;

/** `content` as move `seq` after `prevId`, signed by `seat`'s session key and dated `createdAt`. */
function signed(
  game: TestGame,
  seat: number,
  seq: number,
  prevId: string,
  content: MoveContent,
  createdAt: number,
): NostrEvent {
  const t = moveTemplate({ rootId: game.rootId, prevId, seq, content }, createdAt);
  return finalizeEvent(t, game.ids[seat]!.sessionSk, game.rnd);
}

/** A fresh session of `game` for `seat` (null: a spectator) that trusts `trusted` and has received `events`. */
function holding(
  game: TestGame,
  seat: number | null,
  events: readonly NostrEvent[],
  trusted: readonly NostrEvent[] = events,
): GameSession {
  const s = newSession(game, seat);
  trust([s], trusted);
  deliver([s], events);
  return s;
}

interface RaceGame {
  game: TestGame;
  /** Every event, in the order the live clients received them. */
  log: NostrEvent[];
  /** Every setup step, on the chain or beside it: each fresh session trusts their proofs. */
  steps: NostrEvent[];
  /** The deals: the first event after the setup. */
  firstDeal: NostrEvent;
  /**
   * The late rival steps, delivered during play: `x`, seat 0's step on the losing step of the first race, and `z`,
   * a second one by seat 0 on that prev (equivocation); `junk`, a step by a seat that may not sign there; `y`, the
   * last step on the losing step of the second race, which completes a rival deck.
   */
  late: { x: NostrEvent; z: NostrEvent; junk: NostrEvent; y: NostrEvent };
  /** The live spectator's final view, as `summary` gives it. */
  final: Summary;
}

type Summary = Pick<
  ReturnType<GameSession['view']>,
  'phase' | 'head' | 'equivocators' | 'forfeits' | 'outcome' | 'logHash' | 'audit'
>;

const summary = (s: GameSession): Summary => {
  const v = s.view();
  return {
    phase: v.phase,
    head: v.head,
    equivocators: v.equivocators,
    forfeits: v.forfeits,
    outcome: v.outcome,
    logHash: v.logHash,
    audit: v.audit,
  };
};

const memo = new Map<string, RaceGame>();

/**
 * A whole 3-seat any-order Chain Reaction game, short (the end may be declared once a chain reaches 4 tiles), built
 * once per seed. Seats 1 and 2 race on the root; seat 0 and that race's loser race on the winner; the second race's
 * loser signs the last step. So two setup prevs of the chain hold a losing step each. Every seat deals, and after two
 * game actions the late rival steps arrive; then the game plays out, and every seat reveals its secret.
 */
function raceGame(seed: string): RaceGame {
  const known = memo.get(seed);
  if (known !== undefined) return known;
  const game = makeGame(SEATS, seed, { ...chainReaction.defaultRules(), endSize: 4 }, ANY);
  const players = range(SEATS).map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const log: NostrEvent[] = [];
  const steps: NostrEvent[] = [];
  const send = (evs: readonly NostrEvent[]): void => {
    deliver(all, evs);
    log.push(...evs);
  };
  // Each racer signs on the head it holds and sees its own step first; then every session gets every step.
  const race = (racers: readonly number[], at: number): NostrEvent[] => {
    const evs = racers.map((seat, k) => players[seat]!.buildShuffle(game.rnd, T0 + at + k));
    trust(all, evs);
    for (const [k, seat] of racers.entries()) players[seat]!.receive(evs[k]!, NOW);
    steps.push(...evs);
    send(evs);
    return evs;
  };
  const [a, b] = race([1, 2], 100) as [NostrEvent, NostrEvent];
  const [w1, l1] = a.id < b.id ? [a, b] : [b, a];
  const w1Seat = w1 === a ? 1 : 2;
  const l1Seat = 3 - w1Seat;
  const [c, d] = race([0, l1Seat], 200) as [NostrEvent, NostrEvent];
  const [w2, l2] = c.id < d.id ? [c, d] : [d, c];
  const w2Seat = w2 === c ? 0 : l1Seat;
  const l2Seat = 3 - w1Seat - w2Seat;
  race([l2Seat], 300);
  for (const s of all) {
    expect(s.view().phase).toBe('deal');
    expect(s.view().equivocators).toEqual([]);
  }
  const deals = players.map((p, k) => p.buildDeal(game.rnd, T0 + 400 + k));
  send(deals);
  const x = holding(game, 0, [l1]).buildShuffle(game.rnd, T0 + 600);
  const z = holding(game, 0, [l1]).buildShuffle(game.rnd, T0 + 601);
  const junk = signed(game, l1Seat, 2, l1.id, parseMove(l1, DECK).content, T0 + 602);
  const y = holding(game, w2Seat, [w1, l2]).buildShuffle(game.rnd, T0 + 603);
  const late = { x, z, junk, y };
  steps.push(x, z, junk, y);
  trust(all, [x, z, junk, y]);
  const rng = createRng(`${seed}-policy`);
  let t = T0 + 1000;
  for (let n = 0; spectator.view().phase === 'play'; n++) {
    if (n === 2) send([x, z, junk, y]);
    const p = players[(spectator.view().pending as { seat: number }).seat]!;
    const legal = p.legalActions() as readonly { declareEnd?: boolean }[];
    send([p.buildAction(legal.find((l) => l.declareEnd === true) ?? rng.pick(legal), game.rnd, t++)]);
  }
  expect(log).toContain(x);
  for (const p of players) send([p.buildSecret(game.rnd, t++)]);
  const final = summary(spectator);
  expect(final.phase).toBe('done');
  // Seat 0 signed two steps on one prev of the setup tree.
  expect(final.equivocators).toEqual([0]);
  const out: RaceGame = { game, log, steps, firstDeal: deals[0]!, late, final };
  memo.set(seed, out);
  return out;
}

/** A fresh spectator that trusts every setup step's proof, with the setup-verdict switch as given. */
function fresh(race: RaceGame, keep = true): GameSession {
  const s = newSession(race.game, null);
  (s as unknown as { shareFreeSetupVerdicts: boolean }).shareFreeSetupVerdicts = keep;
  trust([s], race.steps);
  return s;
}

/** The indices of `n` items in an order drawn from `seed` (Fisher-Yates). */
function shuffled(n: number, seed: string): number[] {
  const rng = createRng(seed);
  const out = range(n);
  for (let i = n - 1; i > 0; i--) {
    const k = rng.int(i + 1);
    [out[i], out[k]] = [out[k]!, out[i]!];
  }
  return out;
}

describe('fork choice after an honest setup race (D093)', () => {
  it(
    'after an honest setup race, later events run no fork trials for the dead setup branch',
    () => {
      const race = raceGame('any-perf-0');
      const { x, y } = race.late;
      // The honest events only, and the one late step on the first race's losing branch.
      const events = race.log.filter((ev) => ev !== y && ev !== race.late.z && ev !== race.late.junk);
      const s = fresh(race);
      const from = events.indexOf(race.firstDeal);
      for (const ev of events.slice(0, from)) s.receive(ev, NOW);
      const counts = events.slice(from).map((ev) => {
        const before = trials(s);
        s.receive(ev, NOW);
        return trials(s) - before;
      });
      // The late step changes one fork's pool: one trial there. Nothing else re-tries a setup fork.
      const expected = events.slice(from).map((ev) => (ev === x ? 1 : 0));
      expect(counts).toEqual(expected);
      expect(s.view().phase).toBe('done');
      expect(s.view().head).toEqual(race.final.head);
    },
    LONG,
  );

  it(
    'fork choice after a race gives the same results whatever the delivery order',
    () => {
      for (const seed of ['any-perf-0', 'any-perf-1', 'any-perf-2']) {
        const race = raceGame(seed);
        const orders = range(3).map((k) => shuffled(race.log.length, `${seed}-order-${k}`));
        for (const order of orders) {
          const s = fresh(race);
          for (const i of order) s.receive(race.log[i], NOW);
          expect(summary(s)).toEqual(race.final);
        }
        // The same fold with the setup verdicts keyed on the share version too, as before Task 5b.
        const off = fresh(race, false);
        for (const i of orders[0]!) off.receive(race.log[i], NOW);
        expect(summary(off)).toEqual(race.final);
      }
    },
    LONG,
  );
});

/*
 * The same in a game that reshuffles in play (D094). Until D094 a trial at a setup prev refused for good the Shares
 * events of reshuffle 3 and later, so skipping trials there changed the fold, and such games kept the share-keyed
 * verdict. A 3-seat any-order Holler game races as `raceGame` does (no complete rival deck: its fork keeps the
 * share-keyed verdict either way) and plays until a Shares event of reshuffle 3 is out, and a few events more.
 */

const HOLLER_SEATS = 3;
/** Holler's epoch stride: epoch k's cards sit at `128·k + i`. */
const STRIDE = 128;
/** Events published after the first Shares event of reshuffle 3. */
const EXTRA = 4;

interface HollerRace {
  game: TestGame;
  /** Every event, in the order the live clients received them. */
  log: NostrEvent[];
  /** Every setup step, on the chain or beside it. */
  steps: NostrEvent[];
  /** The setup steps beside the chain: the two race losers and the late steps `x`, `z` and `junk`. */
  side: NostrEvent[];
  /** The index in `log` of the first Shares event of reshuffle 3. */
  firstLate: number;
  final: Summary;
}

/** Plays out Holler rounds fast: a declared play, then any play, then whatever is legal. */
function hollerPick(legal: readonly unknown[], rng: Rng): unknown {
  const plays = legal.filter((a) => (a as { type?: string }).type === 'play');
  const declared = plays.find((a) => (a as { holler?: boolean }).holler === true);
  return declared ?? (plays.length > 0 ? rng.pick(plays) : rng.pick(legal));
}

/** The highest reshuffle a Shares event names, 0 for the opening deck. */
const sharesEpoch = (ev: NostrEvent): number =>
  ev.kind === KIND.shares ? Math.max(0, ...parseShares(ev).shares.map((x) => Math.floor(x.pos / STRIDE))) : 0;

/** Why `s` refused each Shares event of `log` it refused: every one is an honest seat's. */
function refusedShares(s: GameSession, log: readonly NostrEvent[]): string[] {
  const rejected = (s as unknown as { rejected: Map<Hex, string> }).rejected;
  return log.filter((ev) => ev.kind === KIND.shares && rejected.has(ev.id)).map((ev) => rejected.get(ev.id)!);
}

let hollerMemo: HollerRace | null = null;

function hollerRace(): HollerRace {
  if (hollerMemo !== null) return hollerMemo;
  const game = makeModuleGame(holler, HOLLER_SEATS, 'any-perf-holler', undefined, ANY);
  const players = range(HOLLER_SEATS).map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const log: NostrEvent[] = [];
  const steps: NostrEvent[] = [];
  // Every honest event is accepted or kept; only `junk` is refused.
  const send = (evs: readonly NostrEvent[], honest = true): void => {
    const results = deliver(all, evs).flat();
    if (honest) for (const r of results) expect(r.status).not.toBe('rejected');
    log.push(...evs);
  };
  const race = (racers: readonly number[], at: number): NostrEvent[] => {
    const evs = racers.map((seat, k) => players[seat]!.buildShuffle(game.rnd, T0 + at + k));
    trust(all, evs);
    for (const [k, seat] of racers.entries()) players[seat]!.receive(evs[k]!, NOW);
    steps.push(...evs);
    send(evs);
    return evs;
  };
  const [a, b] = race([1, 2], 100) as [NostrEvent, NostrEvent];
  const [w1, l1] = a.id < b.id ? [a, b] : [b, a];
  const l1Seat = w1 === a ? 2 : 1;
  const [c, d] = race([0, l1Seat], 200) as [NostrEvent, NostrEvent];
  const [w2, l2] = c.id < d.id ? [c, d] : [d, c];
  const w2Seat = w2 === c ? 0 : l1Seat;
  const l2Seat = w2Seat === 0 ? l1Seat : 0;
  race([l2Seat], 300);
  send(players.map((p, k) => p.buildDeal(game.rnd, T0 + 400 + k)));
  const x = holding(game, 0, [l1]).buildShuffle(game.rnd, T0 + 600);
  const z = holding(game, 0, [l1]).buildShuffle(game.rnd, T0 + 601);
  const junk = signed(game, l1Seat, 2, l1.id, parseMove(l1, DECK).content, T0 + 602);
  steps.push(x, z, junk);
  trust(all, [x, z, junk]);
  const rng = createRng('any-perf-holler-policy');
  let t = T0 + 1000;
  let firstLate = -1;
  for (let n = 0; n < 50_000; n++) {
    if (firstLate >= 0 && log.length >= firstLate + 1 + EXTRA) break;
    if (n === 2) send([x, z, junk], false);
    let ev: NostrEvent | null = null;
    for (const p of players) {
      const duty = p.duties()[0];
      if (duty?.kind === 'shuffle') {
        ev = p.buildEpoch(game.rnd, t++);
        trust(all, [ev]);
      } else if (duty?.kind === 'share') ev = p.buildShares(game.rnd, t++);
      else if (duty?.kind === 'decide') ev = p.buildAction(hollerPick(p.legalActions(), rng), game.rnd, t++);
      if (ev !== null) break;
    }
    expect(ev).not.toBeNull();
    send([ev!]);
    if (firstLate < 0 && sharesEpoch(ev!) >= 3) firstLate = log.length - 1;
  }
  expect(firstLate).toBeGreaterThanOrEqual(0);
  const final = summary(spectator);
  expect(final.phase).toBe('play');
  // Seat 0 signed two steps on one prev of the setup tree.
  expect(final.equivocators).toEqual([0]);
  expect(refusedShares(spectator, log)).toEqual([]);
  hollerMemo = { game, log, steps, side: [l1, l2, x, z, junk], firstLate, final };
  return hollerMemo;
}

describe('fork choice after an honest setup race in a game that reshuffles in play (D094)', () => {
  it(
    'the share-free setup verdicts give the same fold as the share-keyed ones, past reshuffle 3',
    () => {
      const race = hollerRace();
      const fresh = (keep: boolean): GameSession => {
        const s = newSession(race.game, null);
        (s as unknown as { shareFreeSetupVerdicts: boolean }).shareFreeSetupVerdicts = keep;
        trust([s], race.steps);
        return s;
      };
      // A shuffled delivery order (with the old Shares rule this fold stopped two moves short).
      const mixed = fresh(true);
      for (const i of shuffled(race.log.length, 'any-perf-holler-order-0')) mixed.receive(race.log[i], NOW);
      expect(summary(mixed)).toEqual(race.final);
      expect(refusedShares(mixed, race.log)).toEqual([]);
      // With the share-keyed verdicts every event after a side step re-tries its fork and refolds the whole game, so
      // the side steps come just before the first Shares event of reshuffle 3: each later event tries them again.
      const honest = race.log.filter((ev) => !race.side.includes(ev));
      const at = honest.indexOf(race.log[race.firstLate]!);
      const order = [...honest.slice(0, at), ...race.side, ...honest.slice(at)];
      for (const keep of [true, false]) {
        const s = fresh(keep);
        for (const ev of order) s.receive(ev, NOW);
        expect(summary(s)).toEqual(race.final);
        expect(refusedShares(s, race.log)).toEqual([]);
      }
    },
    LONG,
  );
});
