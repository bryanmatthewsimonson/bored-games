import { createRng, type GameModule, type Rng } from '@bored-games/game-kit';
import type { Hex, NostrEvent } from '@bored-games/protocol';
import { expect } from 'vitest';
import type { Duty, Identity, ReceiveResult } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import { makeModuleGame, NOW, ROOT_SEEN, type TestGame } from '../helpers.ts';

/*
 * Helpers for the protocol 2 session tests with a deck (build plan T8): a table of sessions, the shuffle with its
 * proofs trusted after the first verification, and the automatic duties (deal, release, end, secret) run to rest.
 */

// biome-ignore lint/suspicious/noExplicitAny: a registry holds modules of every game type.
export type AnyModule = GameModule<any, any, any>;

export interface V2Table {
  game: TestGame;
  players: GameSessionV2[];
  spectator: GameSessionV2;
  all: GameSessionV2[];
  /** Every event published so far, in order. */
  log: NostrEvent[];
}

export function v2Session(game: TestGame, seat: number | null, modules = game.modules): GameSessionV2 {
  return GameSessionV2.create({
    modules,
    table: game.table,
    joins: game.joins,
    root: game.root,
    me: seat === null ? null : (game.ids[seat] as Identity),
    rootSeenAt: ROOT_SEEN,
  });
}

/** A proto-2 table of `module` with `seats` seats: one session per seat and a spectator. */
export function v2Table(
  module: AnyModule,
  seats: number,
  seed: string,
  rules: unknown = module.defaultRules(),
  modules?: ReadonlyMap<string, AnyModule>,
): V2Table {
  const base = makeModuleGame(module, seats, seed, rules, '2');
  const game = modules === undefined ? base : { ...base, modules: modules as TestGame['modules'] };
  const players = Array.from({ length: seats }, (_, k) => v2Session(game, k));
  const spectator = v2Session(game, null);
  return { game, players, spectator, all: [...players, spectator], log: [] };
}

/**
 * Shuffle proofs take a second or so each to verify, and they are covered by the shuffle tests. `trustSteps` marks
 * published steps as verified in each session (a test-only shortcut through a private cache), as v1's `trust`.
 */
export function trustSteps(sessions: readonly GameSessionV2[], steps: readonly NostrEvent[]): void {
  for (const s of sessions) {
    const caches = (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches;
    for (const ev of steps) caches.shuffleOk.set(ev.id, true);
  }
}

/** Deliver `ev` to every session of `t` (and log it); returns the statuses. */
export function send(t: V2Table, ev: NostrEvent, sessions: readonly GameSessionV2[] = t.all): string[] {
  t.log.push(ev);
  return sessions.map((s) => s.receive(ev, NOW).status);
}

/** Every seat builds its shuffle steps in turn (each step trusted), delivered to every session. */
export function shuffleAll(t: V2Table): NostrEvent[] {
  const steps: NostrEvent[] = [];
  for (;;) {
    const k = t.players.findIndex((s) => s.duties().some((d) => d.kind === 'shuffle'));
    if (k < 0) return steps;
    const ev = (t.players[k] as GameSessionV2).buildShuffle(t.game.rnd, NOW);
    trustSteps(t.all, [ev]);
    expect(send(t, ev).every((r) => r === 'accepted')).toBe(true);
    steps.push(ev);
  }
}

/** The automatic duty kinds: published with no human decision. */
const AUTO: readonly Duty['kind'][] = ['deal', 'release', 'end', 'secret'];

/** Build `seat`'s event for automatic duty `d`. */
export function buildAuto(t: V2Table, seat: number, d: Duty): NostrEvent {
  const s = t.players[seat] as GameSessionV2;
  switch (d.kind) {
    case 'deal':
      return s.buildDeal(t.game.rnd, NOW);
    case 'release':
      return s.buildRelease(t.game.rnd, NOW);
    case 'end':
      return s.buildEndAttest(t.game.rnd, NOW);
    case 'secret':
      return s.buildSecret(t.game.rnd, NOW);
    default:
      throw new Error(`not automatic: ${d.kind}`);
  }
}

/**
 * Run every seat's automatic duties until none is due, each event delivered to every session; returns them, with
 * each event's duty and seat. Throws if a delivery is rejected.
 */
export function runAuto(
  t: V2Table,
  only: Duty['kind'][] = [...AUTO],
): { seat: number; duty: Duty; ev: NostrEvent }[] {
  const out: { seat: number; duty: Duty; ev: NostrEvent }[] = [];
  for (let guard = 0; guard < 1000; guard++) {
    let did = false;
    for (const [seat, s] of t.players.entries()) {
      const d = s.duties().find((x) => only.includes(x.kind));
      if (d === undefined) continue;
      const ev = buildAuto(t, seat, d);
      const r = send(t, ev);
      if (r.includes('rejected')) throw new Error(`${d.kind} by seat ${seat} rejected: ${r.join(',')}`);
      out.push({ seat, duty: d, ev });
      did = true;
    }
    if (!did) return out;
  }
  throw new Error('automatic duties never settle');
}

/** The seat whose decision is due, or null. */
export function decider(t: V2Table): number | null {
  const k = t.players.findIndex((s) => s.duties().some((d) => d.kind === 'decide'));
  return k < 0 ? null : k;
}

/** `seat` builds `action` and every session receives it; returns the move. */
export function act(t: V2Table, seat: number, action: unknown): NostrEvent {
  const ev = (t.players[seat] as GameSessionV2).buildAction(action, t.game.rnd, NOW);
  const r = send(t, ev);
  expect(r, `move by seat ${seat}`).toEqual(t.all.map(() => 'accepted'));
  return ev;
}

/** A policy: pick one of `legal` for `seat`. */
export type Policy = (legal: readonly unknown[], seat: number, rng: Rng) => unknown;

/** Declares the end as soon as it may, otherwise a random legal action (the sims' `quickPolicy`). */
export const quick: Policy = (legal, _seat, rng) =>
  (legal as readonly { declareEnd?: boolean }[]).find((a) => a.declareEnd === true) ?? rng.pick(legal);

/** Statuses of `ev` received by `sessions`. */
export const statusesOf = (sessions: readonly GameSessionV2[], ev: unknown): ReceiveResult['status'][] =>
  sessions.map((s) => s.receive(ev, NOW).status);

export { createRng };

/** Whether `ev` is a shuffle step (a Move whose content is a shuffle). */
const isStep = (ev: NostrEvent): boolean => {
  try {
    return ev.kind === 7452 && (JSON.parse(ev.content) as { type?: unknown }).type === 'shuffle';
  } catch {
    return false;
  }
};

/**
 * A fresh table on `t`'s game whose sessions have received `log` in order (or `order`, indices into `log`), each
 * shuffle step trusted: a cheap copy of a table at the end of `log`.
 */
export function replay(t: V2Table, log: readonly NostrEvent[] = t.log, order?: readonly number[]): V2Table {
  const players = t.players.map((_, k) => v2Session(t.game, k));
  const spectator = v2Session(t.game, null);
  const copy: V2Table = { game: t.game, players, spectator, all: [...players, spectator], log: [] };
  trustSteps(copy.all, log.filter(isStep));
  for (const i of order ?? log.map((_, j) => j)) send(copy, log[i] as NostrEvent);
  return copy;
}
