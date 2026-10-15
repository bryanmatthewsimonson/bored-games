// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats and steps.

import { createRng, type Rng } from '@bored-games/game-kit';
import { type HollerState, holler } from '@bored-games/holler';
import { type Hex, KIND, type NostrEvent, parseShares } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import type { GameSession } from '../src/session.ts';
import { deliver, makeModuleGame, NOW, newSession, T0, type TestGame, trust } from './helpers.ts';

/*
 * Shares of a late reshuffle after a fold rewound to a setup prev (D094). A fork at a setup prev (a seat's late rival
 * setup step here; an honest race in an any-order game) makes fork choice cut the chain back below the final deck in
 * a trial, which sends every Shares event back to waiting. The relink then folds them as the setup, the play and
 * the reshuffles link again. A Shares event of reshuffle 3 or later used to be refused for good as soon as the final
 * deck relinked, before the reshuffles did, and the chain stalled at the first move that needed its shares.
 */

const SEATS = 2;
/** Holler's epoch stride: epoch k's cards sit at `128·k + i`. */
const STRIDE = 128;
const LONG = 600_000;
/** Events published after the first Shares event of epoch 3: enough for a move that needs its shares. */
const EXTRA = 4;

type Play = { type?: string; holler?: boolean };

/** Plays out rounds fast: a declared play, then any play, then whatever is legal. */
function quick(legal: readonly unknown[], rng: Rng): unknown {
  const plays = legal.filter((a) => (a as Play).type === 'play');
  return (
    plays.find((a) => (a as Play).holler === true) ?? (plays.length > 0 ? rng.pick(plays) : rng.pick(legal))
  );
}

/** The duty `s` owes, built: a shuffle step or an epoch step, a deal, shares or a decision. Null when none. */
function build(s: GameSession, game: TestGame, all: readonly GameSession[], rng: Rng, t: number) {
  const duty = s.duties()[0];
  if (duty === undefined) return null;
  switch (duty.kind) {
    case 'shuffle': {
      const ev = s.view().phase === 'shuffle' ? s.buildShuffle(game.rnd, t) : s.buildEpoch(game.rnd, t);
      trust(all, [ev]);
      return ev;
    }
    case 'deal':
      return s.buildDeal(game.rnd, t);
    case 'share':
      return s.buildShares(game.rnd, t);
    case 'decide':
      return s.buildAction(quick(s.legalActions(), rng), game.rnd, t);
    default:
      return null;
  }
}

/** The epoch of a card position past the opening deck, else 0. */
const epochOf = (pos: number): number => (pos < STRIDE ? 0 : Math.floor(pos / STRIDE));

/** The latest epoch a Shares event names. */
const sharesEpoch = (ev: NostrEvent): number =>
  ev.kind === KIND.shares ? Math.max(0, ...parseShares(ev).shares.map((x) => epochOf(x.pos))) : 0;

interface EpochGame {
  game: TestGame;
  /** Every event, in publication order. */
  log: NostrEvent[];
  /** The seat-order setup steps. */
  steps: NostrEvent[];
  /** The index in `log` of the first Shares event of epoch 3. */
  firstLate: number;
  /** The live spectator, which saw every event of `log` as it was published, and nothing else. */
  live: GameSession;
}

let memo: EpochGame | null = null;

/**
 * A 2-seat seat-order Holler game played until a Shares event of epoch 3 is out, and `EXTRA` events more. Built once
 * (about 45 s: eight shuffle proofs and three sessions).
 */
function epochGame(): EpochGame {
  if (memo !== null) return memo;
  const game = makeModuleGame(holler, SEATS, 'epoch-rewind');
  const players = [0, 1].map((seat) => newSession(game, seat));
  const live = newSession(game, null);
  const all = [...players, live];
  const rng = createRng('epoch-rewind-policy');
  const log: NostrEvent[] = [];
  let firstLate = -1;
  let t = T0 + 100;
  for (let step = 0; step < 50_000; step++) {
    if (firstLate >= 0 && log.length >= firstLate + 1 + EXTRA) break;
    let progressed = false;
    for (const s of players) {
      const ev = build(s, game, all, rng, t++);
      if (ev === null) continue;
      for (const r of deliver(all, [ev])[0]!) expect(r.status).not.toBe('rejected');
      log.push(ev);
      if (firstLate < 0 && sharesEpoch(ev) >= 3) firstLate = log.length - 1;
      progressed = true;
      break;
    }
    if (!progressed) break;
  }
  expect(firstLate).toBeGreaterThanOrEqual(0);
  expect(live.view().phase).toBe('play');
  const steps = log.filter((ev) => ev.kind === KIND.move).slice(0, SEATS);
  memo = { game, log, steps, firstLate, live };
  return memo;
}

/** Why `s` refused each Shares event of `log` it refused: every one is an honest seat's. */
function refusedShares(s: GameSession, log: readonly NostrEvent[]): string[] {
  const rejected = (s as unknown as { rejected: Map<Hex, string> }).rejected;
  return log.filter((ev) => ev.kind === KIND.shares && rejected.has(ev.id)).map((ev) => rejected.get(ev.id)!);
}

describe('Shares of a late reshuffle and a rewind to a setup prev (D094)', () => {
  it(
    'a late rival setup step refuses no Shares event of reshuffle 3 or later, and the chain holds',
    () => {
      const { game, log, steps, firstLate, live } = epochGame();
      expect((live.view().state as HollerState).epoch).toBeGreaterThanOrEqual(3);
      // Seat 1 signs a second step 2 on step 1, long after the setup: a rival at a setup prev.
      const before = newSession(game, 1);
      trust([before], [steps[0]!]);
      before.receive(steps[0]!, NOW);
      const rival = before.buildShuffle(game.rnd, T0 + 50_000);
      // A fresh spectator gets the game up to the first Shares event of epoch 3, then the rival, then the rest.
      const s = newSession(game, null);
      trust([s], [...log, rival]);
      deliver([s], log.slice(0, firstLate + 1));
      s.receive(rival, NOW);
      expect(refusedShares(s, log)).toEqual([]);
      deliver([s], log.slice(firstLate + 1));
      expect(refusedShares(s, log)).toEqual([]);
      expect(s.view().equivocators).toEqual([1]);
      expect(s.view().head).toEqual(live.view().head);
      expect(s.view().state).toEqual(live.view().state);
    },
    LONG,
  );

  it(
    'a Shares event of reshuffle 3 that arrives before the setup waits for its reshuffle',
    () => {
      const { game, log, firstLate, live } = epochGame();
      const s = newSession(game, null);
      trust([s], log);
      const order = [firstLate, ...[...log.keys()].filter((i) => i !== firstLate)];
      const results = order.map((i) => s.receive(log[i], NOW));
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      expect(s.view().head).toEqual(live.view().head);
      expect(s.view().state).toEqual(live.view().state);
    },
    LONG,
  );
});
