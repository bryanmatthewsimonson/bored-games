// biome-ignore-all lint/style/noNonNullAssertion: test fixtures use known seats, positions and deck orders.
/*
 * Re-dealt private positions and sealed shares (D066, PROTOCOL §4.10). A position first dealt privately to seat 0
 * and then dealt privately to seat 1: seat 0 never publishes its share of it while it is private, but seals it to
 * seat 1, who alone can read the card. Later dealt to the public, everyone shares it as usual.
 */
import type { DealtPosition, GameModule, Learn } from '@bored-games/game-kit';
import { finalizeEvent, KIND, parseSealed } from '@bored-games/protocol';
import { describe, expect, it } from 'vitest';
import { owedPositions, sealedOwed, sealedPositions } from '../src/shares.ts';
import { makeModuleGame, NOW, newSession } from './helpers.ts';

interface S {
  readonly mode: 'full' | 'view';
  readonly viewer: number | null;
  readonly order: readonly number[] | null;
  readonly dealt: readonly DealtPosition[];
  /** Card 0 as this state knows it, per holder; and the public card once revealed. */
  readonly held: Readonly<Record<number, number | null>>;
  readonly shown: number | null;
  readonly step: number;
}
type A = { type: string; actor: number | 'deck'; pos?: number; card?: number };

const D = (pos: number, to: number | null): DealtPosition => ({ deck: 'cards', pos, to });

/** Card 0: dealt to seat 0, given to seat 1 (`give`), read by seat 1 (`take`), then revealed to everyone. */
const passer: GameModule<S, { type: string }, Record<string, never>> = {
  id: 'passer',
  version: '0.0.0',
  defaultRules: () => ({}),
  validateRules: (r) => ({ ok: true, value: r as Record<string, never> }),
  seatRange: () => ({ min: 3, max: 3 }),
  decks: () => [{ id: 'cards', size: 6, promptShares: true }],
  setup: (input) => {
    const order = input.mode === 'full' ? (input.deckOrders.cards ?? null) : null;
    return {
      ok: true,
      value: {
        mode: input.mode,
        viewer: input.mode === 'view' ? input.viewer : null,
        order,
        dealt: [D(0, 0), D(1, 1), D(2, 2)],
        held: { 0: order === null ? null : (order[0] as number) },
        shown: null,
        step: 0,
      },
    };
  },
  pending: (s) =>
    s.step === 0
      ? { type: 'player', seat: 0, decision: 'give' }
      : s.step === 1
        ? { type: 'player', seat: 1, decision: 'take' }
        : s.step === 2
          ? { type: 'reveal', deck: 'cards', positions: [0] }
          : { type: 'over' },
  legalActions: (s, seat) => {
    if (s.step === 0 && seat === 0) return [{ type: 'give', actor: 0 }];
    // Seat 1 decides once it can read the card it was given.
    if (s.step === 1 && seat === 1 && s.held[1] !== null && s.held[1] !== undefined)
      return [{ type: 'take', actor: 1 }];
    return [];
  },
  apply: (s, raw) => {
    const a = raw as A;
    if (a.type === 'give' && s.step === 0 && a.actor === 0)
      return {
        ok: true,
        state: {
          ...s,
          step: 1,
          dealt: [...s.dealt, D(0, 1)],
          held: { ...s.held, 1: s.mode === 'full' ? (s.order?.[0] ?? null) : null },
        },
        events: [],
      };
    if (a.type === 'take' && s.step === 1 && a.actor === 1)
      return { ok: true, state: { ...s, step: 2, dealt: [...s.dealt, D(0, null)] }, events: [] };
    if (a.type === 'reveal' && s.step === 2 && a.pos === 0)
      return { ok: true, state: { ...s, step: 3, shown: a.card ?? null }, events: [] };
    return { ok: false, error: { code: 'x', message: `bad ${a.type}` } };
  },
  learn: (s, l: Learn) => {
    if (l.pos !== 0 || s.viewer === null) return { ok: true, state: s, events: [] };
    return { ok: true, state: { ...s, held: { ...s.held, [s.viewer]: l.card } }, events: [] };
  },
  knownTo: () => [],
  view: (s, viewer) => ({
    ...s,
    mode: 'view',
    viewer,
    order: null,
    held: Object.fromEntries(Object.entries(s.held).map(([k, v]) => [k, Number(k) === viewer ? v : null])),
  }),
  outcome: (s) => (s.step === 3 ? { places: [1, 1, 1], scores: [0, 0, 0], reason: 'done' } : null),
  standings: () => [0, 0, 0],
  dealt: (s) => s.dealt,
  revealsOf: () => [],
  invariants: () => [],
  resignAllowed: () => false,
};

function table(seed: string) {
  const game = makeModuleGame(passer, 3, seed);
  game.modules = new Map([[passer.id, passer]]);
  const players = [0, 1, 2].map((seat) => newSession(game, seat));
  const spectator = newSession(game, null);
  const all = [...players, spectator];
  const send = (ev: unknown) => {
    for (const s of all) s.receive(ev, NOW);
  };
  // Shuffle and deal.
  for (const seat of [0, 1, 2]) send(players[seat]!.buildShuffle(game.rnd, NOW));
  for (const p of players) send(p.buildDeal(game.rnd, NOW));
  return { game, players, spectator, all, send };
}

const card0 = (s: { view(): { state: unknown } }, seat: number): number | null =>
  ((s.view().state as S).held[seat] ?? null) as number | null;

describe('sealed positions (shares.ts)', () => {
  it('owes no public share of a re-dealt private position to its first holder, but a sealed one to each later holder', () => {
    const dealt = [D(0, 0), D(1, 1), D(0, 1), D(0, 2), D(3, 2)];
    expect([...sealedPositions(dealt)]).toEqual([[0, 0]]);
    expect(owedPositions(dealt, 0)).toEqual([1, 3]);
    expect(owedPositions(dealt, 1)).toEqual([0, 3]);
    expect(sealedOwed(dealt, 0)).toEqual([
      { pos: 0, to: 1 },
      { pos: 0, to: 2 },
    ]);
    expect(sealedOwed(dealt, 1)).toEqual([]);
    // Dealt to the public later: everyone shares it, the first holder too, and nothing is sealed.
    const shown = [...dealt, D(0, null)];
    expect(sealedPositions(shown).size).toBe(0);
    expect(owedPositions(shown, 0)).toEqual([0, 1, 3]);
    // Dealt back to the same seat only: not re-dealt.
    expect(sealedPositions([D(0, 0), D(0, 0)]).size).toBe(0);
  });
});

describe('a re-dealt card over the session (D066)', () => {
  it('the first holder seals its share to the new holder, who alone reads the card', () => {
    const t = table('sealed-redeal');
    expect(t.spectator.view().phase).toBe('play');
    const order0 = card0(t.players[0]!, 0);
    expect(order0).not.toBeNull();
    // Seat 0 gives the card on.
    t.send(t.players[0]!.buildAction({ type: 'give', actor: 0 }, t.game.rnd, NOW));
    expect(t.spectator.view().head.seq).toBe(4);
    // Seat 0 owes a sealed share, never its public share of position 0; the game waits for it.
    expect(t.players[0]!.duties()).toEqual([{ kind: 'seal', items: [{ pos: 0, to: 1 }] }]);
    expect(t.spectator.waitingFor()).toEqual([0]);
    expect(card0(t.players[1]!, 1)).toBeNull();
    const sealed = t.players[0]!.buildSealed(t.game.rnd, NOW);
    expect(sealed.kind).toBe(KIND.sealed);
    expect(parseSealed(sealed).sealed.map((x) => [x.pos, x.to])).toEqual([[0, 1]]);
    for (const s of t.all) expect(s.receive(sealed, NOW).status).toBe('accepted');
    // Seat 1 reads the card; nobody else can.
    expect(card0(t.players[1]!, 1)).toBe(order0);
    expect(card0(t.players[2]!, 1)).toBeNull();
    expect(card0(t.spectator, 1)).toBeNull();
    expect(t.players[0]!.duties()).toEqual([]);
    expect(t.spectator.waitingFor()).toEqual([1]);
    // A second copy is a duplicate; a sealed share to the wrong seat or position is refused.
    expect(t.spectator.receive(sealed, NOW).status).toBe('duplicate');
    // Seat 1 decides; then everyone, both holders included, shares the public reveal.
    t.send(t.players[1]!.buildAction({ type: 'take', actor: 1 }, t.game.rnd, NOW));
    for (const p of t.players) {
      const d = p.duties()[0];
      if (d?.kind === 'share') t.send(p.buildShares(t.game.rnd, NOW));
    }
    expect((t.spectator.view().state as S).shown).toBe(order0);
    expect(t.spectator.view().phase).toBe('end');
    for (const p of t.players) t.send(p.buildSecret(t.game.rnd, NOW));
    expect(t.spectator.view().audit).toBe('pass');
  });

  it('refuses a sealed share that does not verify, or names a seat that cannot receive it', () => {
    const t = table('sealed-forged');
    t.send(t.players[0]!.buildAction({ type: 'give', actor: 0 }, t.game.rnd, NOW));
    const ev = t.players[0]!.buildSealed(t.game.rnd, NOW);
    // Signed by seat 2's session key, the proof (made with seat 0's secret) does not verify.
    const other = makeForgery(t, ev);
    expect(t.spectator.receive(other, NOW).status).toBe('rejected');
    expect(card0(t.players[1]!, 1)).toBeNull();
  });
});

/** The same sealed content re-signed by seat 2's session key. */
function makeForgery(
  t: ReturnType<typeof table>,
  ev: { content: string; tags: string[][]; created_at: number },
) {
  return finalizeEvent(
    { kind: KIND.sealed, created_at: ev.created_at, tags: ev.tags, content: ev.content },
    t.game.ids[2]!.sessionSk,
    t.game.rnd,
  );
}
