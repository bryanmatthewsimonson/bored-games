import { deepFreeze } from '@bored-games/game-kit';
import { describe, expect, it } from 'vitest';
import { DECK_ID } from '../../src/deck.ts';
import { rightOfWay } from '../../src/module.ts';
import type { RowState } from '../../src/types.ts';
import { act, legal, orderWith, refused, setup, started } from '../helpers.ts';

/** Fold `actions` into `viewer`'s view from setup, learning what the full state says it knows after each. */
function viewAfter(full: RowState[], actions: unknown[], viewer: number | null): RowState {
  const first = full[0] as RowState;
  const r = rightOfWay.setup({ rules: first.rules, seats: first.seats, mode: 'view', viewer });
  if (!r.ok) throw new Error(r.error.message);
  let v = r.value;
  const learned = new Set<number>();
  const learn = (f: RowState) => {
    if (viewer === null) return;
    for (const l of rightOfWay.knownTo(f, viewer)) {
      if (learned.has(l.pos)) continue;
      const res = rightOfWay.learn(v, l);
      if (res.ok) {
        v = res.state;
        learned.add(l.pos);
      }
    }
  };
  learn(first);
  actions.forEach((a, i) => {
    const res = rightOfWay.apply(v, a);
    if (!res.ok) throw new Error(`${JSON.stringify(a)}: ${res.error.message}`);
    v = res.state;
    learn(full[i + 1] as RowState);
  });
  return v;
}

describe('charters', () => {
  it('C27 draw three, keep at least one, return the rest to the bottom in drawn order', () => {
    const s = started(2, orderWith());
    const top = s.charterPile.slice(0, 3);
    const t = act(s, { type: 'charters', actor: 0 });
    expect(t.phase).toBe('charters');
    expect(t.players[0]?.offered.map((c) => c.pos)).toEqual(top);
    expect(legal(t)).toHaveLength(7);
    expect(refused(t, { type: 'keep', actor: 0, keep: [] })).not.toBeNull();
    const u = act(t, { type: 'keep', actor: 0, keep: [1] });
    expect(u.players[0]?.charters.at(-1)?.pos).toBe(top[1]);
    expect(u.charterPile.slice(-2)).toEqual([top[0], top[2]]);
    expect(u.turn).toBe(1);
    // Fewer than three left: draw them all; none left: no charter action.
    const two = deepFreeze({ ...u, charterPile: u.charterPile.slice(-2) });
    const v = act(two, { type: 'charters', actor: 1 });
    expect(v.players[1]?.offered).toHaveLength(2);
    const none = deepFreeze({ ...u, charterPile: [] });
    expect(legal(none).some((a) => a.type === 'charters')).toBe(false);
    expect(refused(none, { type: 'charters', actor: 1 })).toMatch(/No charters/);
  });

  it('C28 charters are secret from the other seats and spectators until the end; counts are public', () => {
    const s = started(3, orderWith());
    for (const viewer of [null, 1, 2]) {
      const v = rightOfWay.view(s, viewer);
      expect(v.players[0]?.charters.every((c) => c.card === null)).toBe(true);
      expect(v.players[0]?.charters).toHaveLength(3);
    }
    expect(rightOfWay.view(s, 0).players[0]?.charters.every((c) => c.card !== null)).toBe(true);
    const t = act(act(s, { type: 'charters', actor: s.turn }), { type: 'keep', actor: s.turn, keep: [0] });
    const seat = s.turn;
    const v = rightOfWay.view(t, (seat + 1) % 3);
    expect(v.players[seat]?.memory).toHaveLength(2);
    expect(v.players[seat]?.memory.every((m) => m.card === null)).toBe(true);
  });

  it('C41 a returned charter drawn again by another seat is dealt to it; its first holder still knows it', () => {
    const full: RowState[] = [];
    const actions: unknown[] = [];
    let s = setup(2, orderWith());
    full.push(s);
    const play = (a: unknown) => {
      s = act(s, a);
      actions.push(a);
      full.push(s);
    };
    play({ type: 'keep', actor: 0, keep: [0, 1, 2] });
    play({ type: 'keep', actor: 1, keep: [0, 1, 2] });
    play({ type: 'charters', actor: 0 });
    const returned = s.players[0]?.offered.slice(1).map((c) => c.pos) as number[];
    play({ type: 'keep', actor: 0, keep: [0] });
    // Seat 1 draws until the returned charters come up.
    while (!s.charterPile.slice(0, 3).some((p) => returned.includes(p))) {
      play({ type: 'charters', actor: s.turn });
      play({ type: 'keep', actor: s.turn, keep: [0, 1, 2].slice(0, s.players[s.turn]?.offered.length) });
    }
    const drawer = s.turn;
    play({ type: 'charters', actor: drawer });
    const redealt = s.players[drawer]?.offered.filter((c) => returned.includes(c.pos)) ?? [];
    expect(redealt.length).toBeGreaterThan(0);
    for (const c of redealt) {
      const entries = s.dealt.filter((d) => d.pos === c.pos);
      expect(entries.map((d) => d.to)).toEqual([0, drawer]);
    }
    if (drawer !== 0) {
      // The new holder learns it (here from the full state, as the session's sealed share lets it); the first
      // holder still knows it; a spectator does not.
      const mine = viewAfter(full, actions, drawer);
      expect(
        mine.players[drawer]?.offered.filter((c) => returned.includes(c.pos)).every((c) => c.card !== null),
      ).toBe(true);
      const first = viewAfter(full, actions, 0);
      expect(
        first.players[0]?.memory.filter((m) => returned.includes(m.pos)).every((m) => m.card !== null),
      ).toBe(true);
      const spectator = viewAfter(full, actions, null);
      expect(spectator.players[drawer]?.offered.every((c) => c.card === null)).toBe(true);
    }
    // A seat that draws back a charter it returned knows it at once, with no learn.
    const back = deepFreeze({
      ...full[4],
      charterPile: returned,
      turn: 0,
      phase: 'turn' as const,
    }) as RowState;
    const v = rightOfWay.view(back, 0);
    const res = rightOfWay.apply(v, { type: 'charters', actor: 0 });
    if (!res.ok) throw new Error(res.error.message);
    expect(res.state.players[0]?.offered.every((c) => c.card !== null)).toBe(true);
    expect(res.state.dealt.slice(-returned.length)).toEqual(
      returned.map((pos) => ({ deck: DECK_ID, pos, to: 0 })),
    );
  });
});
