// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats and positions.
/*
 * A decision that waits for a card the deciding seat drew on its own move (D090). In a game that reshuffles in play
 * (epochs, D073) and has no prompt shares, the other seats deliver their shares of a card dealt to another seat on
 * their own next move (R1). With three or more seats the turn can come back to the seat that drew before one of
 * them moves again (Holler: a seat accepts a Levy and draws, then a Swing reverses the order). The decision then
 * waits for that seat's share, the seat is stalled, and before the fix it had no duty, so an honest seat was timed
 * out: `pnpm sim --game holler --seats 3` found it. Now the stalled seat owes exactly those shares.
 */
import type { DealtPosition, GameModule, Learn } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { makeModuleGame, NOW, newSession } from './helpers.ts';

interface S {
  readonly mode: 'full' | 'view';
  readonly viewer: number | null;
  readonly order: readonly number[] | null;
  readonly dealt: readonly DealtPosition[];
  /** The card seat 1 drew (position 3), as this state knows it. */
  readonly drawn: number | null;
  readonly step: number;
}
type A = { type: string; actor: number };

const D = (pos: number, to: number | null): DealtPosition => ({ deck: 'pile', pos, to });

/** Seat 1 draws position 3 on its own move, seat 0 passes, then seat 1 must play the card it drew. */
const drawer: GameModule<S, { type: string }, Record<string, never>> = {
  id: 'drawer',
  version: '0.0.0',
  defaultRules: () => ({}),
  validateRules: (r) => ({ ok: true, value: r as Record<string, never> }),
  seatRange: () => ({ min: 3, max: 3 }),
  decks: () => [{ id: 'pile', size: 6 }],
  setup: (input) => {
    const order = input.mode === 'full' ? (input.deckOrders.pile ?? null) : null;
    return {
      ok: true,
      value: {
        mode: input.mode,
        viewer: input.mode === 'view' ? input.viewer : null,
        order,
        dealt: [D(0, 0), D(1, 1), D(2, 2)],
        drawn: null,
        step: 0,
      },
    };
  },
  pending: (s) =>
    s.step === 0
      ? { type: 'player', seat: 1, decision: 'draw' }
      : s.step === 1
        ? { type: 'player', seat: 0, decision: 'pass' }
        : s.step === 2
          ? { type: 'player', seat: 1, decision: 'play' }
          : { type: 'over' },
  legalActions: (s, seat) => {
    if (s.step === 0 && seat === 1) return [{ type: 'draw', actor: 1 }];
    if (s.step === 1 && seat === 0) return [{ type: 'pass', actor: 0 }];
    // Seat 1 plays the card it drew once it can read it.
    if (s.step === 2 && seat === 1 && s.drawn !== null) return [{ type: 'play', actor: 1 }];
    return [];
  },
  apply: (s, raw) => {
    const a = raw as A;
    if (a.type === 'draw' && s.step === 0 && a.actor === 1)
      return {
        ok: true,
        state: {
          ...s,
          step: 1,
          dealt: [...s.dealt, D(3, 1)],
          drawn: s.mode === 'full' ? s.order![3]! : null,
        },
        events: [],
      };
    if (a.type === 'pass' && s.step === 1 && a.actor === 0)
      return { ok: true, state: { ...s, step: 2 }, events: [] };
    if (a.type === 'play' && s.step === 2 && a.actor === 1)
      return { ok: true, state: { ...s, step: 3 }, events: [] };
    return { ok: false, error: { code: 'x', message: `bad ${a.type}` } };
  },
  learn: (s, l: Learn) =>
    l.pos === 3 && s.viewer === 1
      ? { ok: true, state: { ...s, drawn: l.card }, events: [] }
      : { ok: true, state: s, events: [] },
  knownTo: () => [],
  view: (s, viewer) => ({ ...s, mode: 'view', viewer, order: null, drawn: viewer === 1 ? s.drawn : null }),
  outcome: (s) => (s.step === 3 ? { places: [1, 1, 1], scores: [0, 0, 0], reason: 'done' } : null),
  standings: () => [0, 0, 0],
  dealt: (s) => s.dealt,
  revealsOf: () => [],
  invariants: () => [],
  // Epoch capability (D073), never used here: it is what makes the play-phase share duties apply.
  installDeckOrder: () => ({ ok: false, error: { code: 'x', message: 'no epochs here' } }),
  shufflePlaintexts: () => [],
};

describe('a decision waiting for a card its own seat drew (D090)', () => {
  it('the seat whose share it waits for owes that share, so the game goes on', () => {
    const game = makeModuleGame(drawer, 3, 'decision-shares');
    game.modules = new Map([[drawer.id, drawer]]);
    const players = [0, 1, 2].map((seat) => newSession(game, seat));
    const spectator = newSession(game, null);
    const all = [...players, spectator];
    const send = (ev: unknown): void => {
      for (const s of all) expect(s.receive(ev, NOW).status).toBe('accepted');
    };
    for (const seat of [0, 1, 2]) send(players[seat]!.buildShuffle(game.rnd, NOW));
    for (const p of players) send(p.buildDeal(game.rnd, NOW));
    expect(spectator.view().phase).toBe('play');

    send(players[1]!.buildAction({ type: 'draw', actor: 1 }, game.rnd, NOW));
    // Seat 0's move carries its share of the drawn card (R1); seat 2 has not moved since the draw.
    send(players[0]!.buildAction({ type: 'pass', actor: 0 }, game.rnd, NOW));
    expect(spectator.view().pending).toEqual({ type: 'player', seat: 1, decision: 'play' });
    expect(players[1]!.legalActions()).toEqual([]);
    expect(spectator.waitingFor()).toEqual([2]);
    // The stalled seat has a duty for exactly what it withholds; before the fix it had none.
    expect(players[2]!.duties()).toEqual([{ kind: 'share', positions: [3] }]);
    expect(players[0]!.duties()).toEqual([]);
    send(players[2]!.buildShares(game.rnd, NOW));
    expect(players[2]!.duties()).toEqual([]);
    expect(spectator.waitingFor()).toEqual([1]);
    expect(players[1]!.legalActions()).toEqual([{ type: 'play', actor: 1 }]);
    send(players[1]!.buildAction({ type: 'play', actor: 1 }, game.rnd, NOW));
    expect(spectator.view().phase).toBe('end');
    for (const p of players) send(p.buildSecret(game.rnd, NOW));
    expect(spectator.view()).toMatchObject({ phase: 'done', audit: 'pass', forfeits: [] });
  });
});
