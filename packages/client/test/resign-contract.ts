/*
 * The Resign contract (PROTOCOL §4.9, §8.3, D052, D090), as helpers so that both the client tests (their own
 * MODULES) and the web tests (every module the app registers, apps/web/src/net.ts) run it. The owner's rule: Resign
 * is never disabled, in any game, at any seat count. So for every module:
 *
 * - `checkResignOffered`: at every seat count of its default rules, every seat may resign (`canResign()`), its
 *   Resign has the game's one content form (the deck secret exactly when the game has a deck), and every client
 *   accepts it. Before the first game action it cancels the game, and in a game with a deck every other seat still
 *   owes its secret. There is no module hook to opt out (`resignAllowed` is gone), and the check says so.
 * - `checkResignMidGame`: a whole game between independent clients over the in-memory relay (`simulateGame`), in
 *   which one seat resigns at its first turn past a mid-game chain length, whatever the game is waiting for then (a
 *   public or scoring reveal, a dice beacon, a reshuffle epoch, a sealed share, a private show, another seat's
 *   decision). The game ends for everyone, every remaining seat publishes its secret, the partial audit passes, the
 *   resigner is last alone (unrated with `endedBy` at 3 or more seats, a plain loss at 2), nobody claims a timeout,
 *   and every client agrees with the spectator.
 */
import { type GameModule, type Rng, range } from '@bored-games/game-kit';
import { expect } from 'vitest';
import { shuffleSchedule } from '../src/partitioned-deck.ts';
import { type SimPolicy, type SimReport, simulateGame } from '../src/sim.ts';
import { resignAny, unexpected } from './adversaries.ts';
import { makeModuleGame, newSession, T0, type TestGame } from './helpers.ts';

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
type AnyModule = GameModule<any, any, any>;

/** The seat that resigns in `checkResignMidGame`. */
export const RESIGNER = 1;
/**
 * Game actions played before the resigning seat may resign: past the opening, before a game of random moves can end
 * (two seats of Quill & Quarry passing six times, or Room for Doubt's wrong indictments). `pnpm sim --adversary
 * resignAny --vanish-at n` resigns deeper into a game.
 */
const MID_GAME = 4;

/** Every seat count of `module`'s default rules. */
export function seatCounts(module: AnyModule): number[] {
  const { min, max } = module.seatRange(module.defaultRules());
  return range(max - min + 1).map((i) => min + i);
}

const hasDeck = (module: AnyModule): boolean => module.decks(module.defaultRules()).length > 0;

/** The shuffle steps at the start of `module`'s chain at `seats` seats (none when deckless). */
export function shuffleSteps(module: AnyModule, seats: number): number {
  return shuffleSchedule(module.decks(module.defaultRules(), seats)[0] ?? null, seats).length;
}

/**
 * At every seat count, every seat may resign, and a Resign naming the root is accepted by every client: it cancels
 * the game (no game action yet), and in a game with a deck the other seats still owe their secrets (D052).
 */
export function checkResignOffered(module: AnyModule): void {
  expect('resignAllowed' in module, `${module.id} has a Resign opt-out hook`).toBe(false);
  for (const seats of seatCounts(module)) {
    const made = makeModuleGame(module, seats, `resign-offered-${module.id}-${seats}`);
    const game = { ...made, modules: new Map([[module.id, module]]) } as unknown as TestGame;
    const sessions = range(seats).map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    for (const s of sessions) expect(s.canResign(), `${module.id}, ${seats} seats`).toBe(true);
    const resigner = seats - 1;
    const resign = (sessions[resigner] as (typeof sessions)[number]).buildResign(game.rnd, T0 + 50);
    const content = JSON.parse(resign.content) as Record<string, unknown>;
    expect('secret' in content, `${module.id}: the Resign carries a secret iff the game has a deck`).toBe(
      hasDeck(module),
    );
    for (const s of [...sessions, spectator]) {
      expect(s.receive(resign, T0 + 60), `${module.id}, ${seats} seats`).toEqual({ status: 'accepted' });
      expect(s.view()).toMatchObject({ phase: 'cancelled', resigned: [resigner], outcome: null });
      expect(s.canResign()).toBe(false);
    }
    for (const [seat, s] of sessions.entries()) {
      const owes = hasDeck(module) && seat !== resigner ? [{ kind: 'secret' }] : [];
      expect(s.duties(), `${module.id}, ${seats} seats, seat ${seat}`).toEqual(owes);
    }
  }
}

/** A play that leaves one card without declaring it sticks the next turn, so the contract prefers the declaration. */
function continuing(moduleId: string, legal: readonly unknown[]): readonly unknown[] {
  if (moduleId !== 'holler') return legal;
  const declared = legal.filter((action) => {
    const play = action as { type?: string; holler?: boolean; pos?: number };
    if (play.type !== 'play' || play.holler === true) return true;
    return !legal.some((other) => {
      const twin = other as { type?: string; holler?: boolean; pos?: number };
      return twin.type === 'play' && twin.holler === true && twin.pos === play.pos;
    });
  });
  return declared.length > 0 ? declared : legal;
}

/** Uniform legal play that never declares the end, so the game is still going when the seat resigns. */
function playOn(moduleId: string): SimPolicy {
  return (_state, _seat, legal, rng: Rng) => {
    const on = continuing(
      moduleId,
      (legal as readonly { declareEnd?: boolean }[]).filter((a) => a.declareEnd !== true),
    );
    return rng.pick(on.length > 0 ? on : legal);
  };
}

/** Seeds a mid-game check may try: a game of random moves can end by its rules before the seat resigns. */
const ATTEMPTS = 3;

/**
 * A whole simulated game of `module` at `seats` seats in which seat `RESIGNER` resigns at its first turn once the
 * chain holds `MID_GAME` game actions past the shuffle, whatever is pending then. Returns the report after checking
 * it: the game ends by the Resign for every client, with every secret in and the partial audit passing. A game that
 * ended by its own rules before the seat could resign (its random moves ended it early) is played again with another
 * seed, at most `ATTEMPTS` times; any other failure fails at once. The policy is uniform legal play that never declares
 * the end unless `opts.policy` names one (the web test passes each game's first fuzz policy, as `pnpm sim` uses), and
 * the move deadline is one day unless `opts.deadline` says otherwise (a game's `simDeadline`).
 */
export function checkResignMidGame(
  module: AnyModule,
  seats: number,
  opts: { policy?: SimPolicy; deadline?: number; seed?: string } = {},
): SimReport {
  const seed = opts.seed ?? 'resign-mid-game';
  const atSeq = shuffleSteps(module, seats) + MID_GAME;
  let report: SimReport | null = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    report = simulateGame({
      seats,
      seed: `${seed}-${module.id}-${seats}${attempt === 0 ? '' : `-${attempt}`}`,
      modules: new Map([[module.id, module]]),
      game: module.id,
      policy: opts.policy ?? playOn(module.id),
      ...(opts.deadline === undefined ? {} : { deadline: opts.deadline }),
      adversary: resignAny(RESIGNER, atSeq),
      maxRounds: 50_000,
    });
    const endedFirst = report.cheats.length === 0 && report.failures.length === 0 && report.outcome !== null;
    if (!endedFirst) break;
  }
  if (report === null) throw new Error('no attempt');
  const where = `${module.id} at ${seats} seats`;
  expect(report.failures, where).toEqual([]);
  expect(unexpected(report, RESIGNER), where).toEqual([]);
  // It resigned mid-game: past the first game action, before the game could end by its rules.
  expect(report.actions, where).toBeGreaterThanOrEqual(MID_GAME);
  expect(report.phase, where).toBe('done');
  expect(report.outcome?.reason, where).toBe('resign');
  expect(report.audit, where).toEqual({ fail: [RESIGNER], reason: 'resign' });
  // Every remaining seat attests the result (the resigner may still be about to).
  const others = range(seats).filter((k) => k !== RESIGNER);
  expect(
    report.attested.filter((k) => k !== RESIGNER),
    where,
  ).toEqual(others);
  return report;
}
