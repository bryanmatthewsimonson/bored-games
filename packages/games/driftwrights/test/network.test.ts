import { canonicalJson, createRng, shuffle } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { chooseForTest } from '../src/choices.ts';
import { driftwrights as game, type NetworkState } from '../src/module.ts';
import type { Action } from '../src/types.ts';

const root = 'ab'.repeat(32);
const rules = game.defaultRules();
function apply(s: NetworkState, action: unknown) {
  const r = game.apply(s, action);
  if (!r.ok) throw new Error(`${canonicalJson(action)}: ${r.error.message}`);
  return r.state;
}
function init(seats: number, order: readonly number[], viewer?: number | null) {
  const r = game.setup(
    viewer === undefined
      ? { seats, rules, mode: 'full', deckOrders: { ventures: order } }
      : { seats, rules, mode: 'view', viewer },
  );
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}
describe('decentralized Driftwrights adapter', () => {
  it('reveals only the landmarks actually included in a victory declaration', () => {
    const s = init(
      3,
      Array.from({ length: 25 }, (_, i) => i),
    );
    const full: NetworkState = {
      ...s,
      stage: 'roll',
      starter: 0,
      span: 0,
      watch: 0,
      buildings: s.buildings.map((_, i) => ([0, 7, 12].includes(i) ? { seat: 0, hub: true } : null)),
      ventureNext: 2,
      players: s.players.map((p, i) =>
        i
          ? p
          : {
              ...p,
              ventures: [
                { pos: 0, card: 20, bought: -1 },
                { pos: 1, card: 21, bought: -1 },
              ],
            },
      ),
    };
    const spectator = game.view(full, null);
    const declaration = { type: 'declare', actor: 0, landmarks: [{ deck: 'ventures', pos: 0, card: 20 }] };
    const ended = apply(full, declaration);
    const watched = apply(spectator, declaration);
    expect(game.view(ended, null)).toEqual(watched);
    expect(watched.players[0]?.ventures.map((v) => v.card)).toEqual([20, -1]);
  });
  for (const seats of [3, 4])
    it(`replays a complete ${seats}-seat game in independent private views`, () => {
      const rng = createRng(`network-${seats}`);
      const order = shuffle(
        Array.from({ length: 25 }, (_, i) => i),
        rng,
      );
      let full = init(seats, order);
      let views = Array.from({ length: seats + 1 }, (_, i) => init(seats, order, i === seats ? null : i));
      const tags = new Set<string>();
      for (let step = 0; step < 30000 && !full.result; step++) {
        const p = game.pending(full);
        let action: unknown;
        const plan = game.privateSelection?.(full);
        if (p.type === 'beacon') {
          const shape = game.rollShape?.(full) ?? { count: 2, sides: 6 };
          action = {
            type: 'rolled',
            actor: 'beacon',
            id: p.id,
            dice: Array.from({ length: shape.count }, () => 1 + rng.int(shape.sides)),
          };
        } else if (plan) {
          const card = plan.labels?.[plan.index];
          if (card === undefined) throw new Error('missing private resource');
          const learned = game.learn(full, { deck: 'supplies', pos: plan.id, card });
          if (!learned.ok) throw new Error(learned.error.message);
          full = learned.state;
          views = views.map((v, i) => {
            if (i !== plan.from && i !== plan.to) return v;
            const l = game.learn(v, { deck: 'supplies', pos: plan.id, card });
            if (!l.ok) throw new Error(l.error.message);
            return l.state;
          });
          action = {
            type: 'transfer',
            actor: plan.from,
            id: plan.id,
            root,
            anchor: root,
            after: root,
            packets: [
              { to: Math.min(plan.from, plan.to), ciphertext: 'test-only' },
              { to: Math.max(plan.from, plan.to), ciphertext: 'test-only' },
            ],
          };
        } else if (p.type === 'player') {
          const options = game.legalActions(views[p.seat] as NetworkState, p.seat);
          expect(options.length, `no choice at ${full.stage}`).toBeGreaterThan(0);
          const only = options[0] as { type: string };
          action = ['contribute', 'declare', 'requisition-payment'].includes(only.type)
            ? only
            : chooseForTest(views[p.seat] as NetworkState, options as Action[]);
        } else throw new Error('unexpected pending state');
        tags.add((action as { type: string }).type);
        full = apply(full, action);
        views = views.map((v) => apply(v, action));
        for (const d of game.dealt(full)) {
          if (d.to === null) continue;
          const v = views[d.to] as NetworkState;
          if (game.knownTo(v, d.to).some((l) => l.pos === d.pos)) continue;
          const card = order[d.pos];
          if (card === undefined) throw new Error('missing venture');
          const learned = game.learn(v, { deck: 'ventures', pos: d.pos, card });
          // Played ventures remain in the append-only dealt list but are no longer held.
          if (learned.ok) views[d.to] = learned.state;
        }
        expect(game.invariants(full)).toEqual([]);
        for (const [i, view] of views.entries()) {
          expect(game.invariants(view)).toEqual([]);
          expect(view).toEqual(game.view(full, i === seats ? null : i));
        }
      }
      expect(full.result).not.toBeNull();
      expect(tags.has('transfer')).toBe(true);
      expect(tags.has('buy-venture')).toBe(true);
      expect(tags.has('declare')).toBe(true);
    });
  it('rejects raw player entropy, malformed rules, and forged private deliveries', () => {
    const s = init(
      3,
      Array.from({ length: 25 }, (_, i) => i),
      0,
    );
    expect(game.apply(s, { type: 'dice', actor: 0, faces: [6, 6] }).ok).toBe(false);
    expect(game.learn(s, { deck: 'supplies', pos: 0, card: 1 }).ok).toBe(false);
    expect(game.validateRules({ layout: 'classic', extra: true }).ok).toBe(false);
    expect(game.resignAllowed?.(rules, 3)).toBe(false);
  });
});
