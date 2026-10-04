import { canonicalJson, createRng, type GameModule, type Rng } from '@bored-games/game-kit';
import { finalizeEvent, type Hex, moveTemplate, type NostrEvent } from '@bored-games/protocol';
import { expect } from 'vitest';
import type { Duty, Identity, ReceiveResult } from '../../src/types.ts';
import { GameSessionV2 } from '../../src/v2/session.ts';
import { makeModuleGame, NOW, ROOT_SEEN, type TestGame } from '../helpers.ts';

/*
 * Helpers for the protocol 2 session tests (build plan T8, T9): a table of sessions, the shuffle with its proofs
 * trusted after the first verification, and the automatic duties (deal, release, roll, end, secret) run to rest.
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

/** A session's shuffle-proof cache (a test-only view of a private field). */
const cachesOf = (s: GameSessionV2): { shuffleOk: Map<Hex, boolean> } =>
  (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches;

/**
 * The steps known honest: built by `buildShuffle` and trusted with `trustSteps`. `replay` trusts only these (and the
 * ones a caller names), so a forged step is verified for real there (review of T10, L1).
 */
const HONEST = new Set<Hex>();

/**
 * Real verdicts of shuffle steps, by id, shared by every replayed session (a verdict depends on the step's line,
 * which its id fixes): each forged step is verified once per test file.
 */
const VERDICTS = new Map<Hex, boolean>();

/**
 * Shuffle proofs take a second or so each to verify, and they are covered by the shuffle tests. `trustSteps` marks
 * published steps as verified in each session (a test-only shortcut through a private cache), as v1's `trust`, and
 * records them as honest for `replay`. Only ever pass steps built by `buildShuffle`: a forged step must never be
 * trusted (to build play on one, pass it to `replay`'s `trust` instead).
 */
export function trustSteps(sessions: readonly GameSessionV2[], steps: readonly NostrEvent[]): void {
  for (const ev of steps) {
    HONEST.add(ev.id);
    VERDICTS.set(ev.id, true);
  }
  for (const s of sessions) for (const ev of steps) cachesOf(s).shuffleOk.set(ev.id, true);
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
const AUTO: readonly Duty['kind'][] = ['deal', 'release', 'roll', 'end', 'secret'];

/** Build `seat`'s event for automatic duty `d`. */
export function buildAuto(t: V2Table, seat: number, d: Duty): NostrEvent {
  const s = t.players[seat] as GameSessionV2;
  switch (d.kind) {
    case 'deal':
      return s.buildDeal(t.game.rnd, NOW);
    case 'release':
      return s.buildRelease(t.game.rnd, NOW);
    case 'roll':
      return s.buildRoll(d.move, t.game.rnd, NOW);
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
 * A fresh table on `t`'s game whose sessions have received `log` in order (or `order`, indices into `log`): a cheap
 * copy of a table at the end of `log`. Only honest shuffle steps (`trustSteps`) are trusted, and those in `trust`; any
 * other step is verified for real, its verdict shared through `VERDICTS` (review of T10, L1: a forged step must fail
 * in a replay, so that play on it never counts). A step in `trust` is trusted in this copy only (to build play on a
 * forged step), and the copy's verdicts are then kept apart from `VERDICTS`.
 */
export function replay(
  t: V2Table,
  log: readonly NostrEvent[] = t.log,
  order?: readonly number[],
  trust: readonly NostrEvent[] = [],
): V2Table {
  const players = t.players.map((_, k) => v2Session(t.game, k));
  const spectator = v2Session(t.game, null);
  const copy: V2Table = { game: t.game, players, spectator, all: [...players, spectator], log: [] };
  const verdicts = trust.length === 0 ? VERDICTS : new Map(VERDICTS);
  for (const ev of log.filter(isStep)) if (HONEST.has(ev.id)) verdicts.set(ev.id, true);
  for (const ev of trust) verdicts.set(ev.id, true);
  for (const s of copy.all)
    (s as unknown as { caches: { shuffleOk: Map<Hex, boolean> } }).caches.shuffleOk = verdicts;
  for (const i of order ?? log.map((_, j) => j)) send(copy, log[i] as NostrEvent);
  return copy;
}

/** A Move signed by `seat`'s session key on `prev` with `seq` and `content`, built by hand (no duty check). */
export function signedMove(
  t: V2Table,
  seat: number,
  prevId: Hex,
  seq: number,
  content: Parameters<typeof moveTemplate>[0]['content'],
  at = NOW,
): NostrEvent {
  return finalizeEvent(
    moveTemplate({ rootId: t.game.rootId, prevId, seq, content }, at, '2'),
    (t.game.ids[seat] as Identity).sessionSk,
    t.game.rnd,
  );
}

/** A game-action Move by `seat` on `prev` (no shares or reveals), built by hand. */
export const actionAt = (t: V2Table, seat: number, prevId: Hex, seq: number, action: unknown, at = NOW) =>
  signedMove(t, seat, prevId, seq, { type: 'action', action, reveals: [], shares: [] }, at);

/** Everything a session shows: every session's view, each player's duties, the spectator's waiting seats. */
export const digest = (t: V2Table): string =>
  canonicalJson({
    views: t.all.map((s) => s.view()),
    duties: t.players.map((s) => s.duties()),
    waiting: t.spectator.waitingFor(),
    held: t.spectator.heldSet(),
  });

/**
 * Replays `log` into fresh tables in `count` shuffled orders (each with a few duplicates) and the given order, and
 * expects the same digest from every one; returns the in-order table.
 */
export function inOrders(t: V2Table, log: readonly NostrEvent[], seed: string, count = 3): V2Table {
  const reference = replay(t, log);
  const want = digest(reference);
  const rng = createRng(seed);
  for (let n = 0; n < count; n++) {
    const order = log.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    for (let d = 0; d < 3; d++) order.splice(rng.int(order.length + 1), 0, rng.int(log.length));
    expect(digest(replay(t, log, order)), `order ${n} of ${seed}`).toBe(want);
  }
  return reference;
}
