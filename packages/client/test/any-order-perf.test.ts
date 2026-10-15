// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats and steps.

import { chainReaction } from '@bored-games/chain-reaction';
import { createRng, range } from '@bored-games/game-kit';
import {
  finalizeEvent,
  type MoveContent,
  moveTemplate,
  type NostrEvent,
  parseMove,
} from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { deliver, makeGame, NOW, newSession, T0, type TestGame, trust } from './helpers.ts';

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
